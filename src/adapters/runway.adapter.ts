import type { BrowserView } from 'electron'
import {
  RUNWAY_SELECTORS,
  ADAPTER_TIMEOUT,
  POLL_INTERVAL,
  MAX_WAIT_TIME,
  getRunwayURL,
  clickOptionByTextJS,
  clickSettingByLabelJS,
  clickValueChipByTextJS,
} from './runway.selectors'
import { MODEL_CAPS } from '../types/models'
import { logger } from '../logs/logger'

export type GenerationStatus = 'idle' | 'generating' | 'completed' | 'failed'

export interface GenerationResult {
  status: GenerationStatus
  videoUrl?: string
  error?: string
}

export interface IRunwayAdapter {
  resetPage(): Promise<void>
  selectModel(modelId: string): Promise<void>
  fillPrompt(prompt: string): Promise<void>
  clickGenerate(): Promise<void>
  checkStatus(): Promise<GenerationStatus>
  waitForCompletion(taskId?: string): Promise<GenerationResult>
  acquireLock(): Promise<void>
  releaseLock(): void
  acquireLockForTask(taskId: string): Promise<void>
  releaseLockForTask(taskId: string): void
  /** 上传参考图到 Runway 页面 */
  uploadReferenceImages(imagePaths: string[], modelId: string): Promise<void>
  /** 选择视频时长（秒） */
  selectDuration(duration: number): Promise<void>
  /** 选择视频分辨率 */
  selectResolution(resolution: string): Promise<void>
  /** 选择画面比例 */
  selectAspectRatio(ratio: string): Promise<void>
  /** 并发提交：仅提交不等待，完成后由 CDP monitor 回调 */
  submitOnly(taskId: string, modelId: string, prompt: string, imagePaths?: string[], duration?: number, resolution?: string, aspectRatio?: string): Promise<void>
  /** 启动持久 CDP 网络监听（应用启动时调用一次） */
  startPersistentMonitor(): Promise<void>
  stopPersistentMonitor(): void
  /** Runway 槽位查询 */
  getAvailableSlots(): number
  hasSlot(): boolean
  /** 注册完成回调和槽位释放回调 */
  setCompletionCallback(cb: (taskId: string, result: GenerationResult) => void): void
  setSlotFreedCallback(cb: () => void): void
  /** 注册 CDP monitor 阻塞/恢复回调（DevTools 抢占 debugger 时通知） */
  setMonitorBlockedCallback(cb: (blocked: boolean) => void): void
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`)),
        timeoutMs,
      ),
    ),
  ])
}

/** 异步互斥锁：确保同一时间只有一个任务在操作 Runway 页面 */
class AsyncLock {
  private locked = false
  private queue: Array<{ resolve: () => void; taskId: string }> = []

  async acquire(taskId: string): Promise<void> {
    if (!this.locked) {
      this.locked = true
      console.log(`[Adapter.Lock] Acquired by ${taskId}`)
      return
    }
    console.log(`[Adapter.Lock] ${taskId} waiting for lock...`)
    return new Promise((resolve) => {
      this.queue.push({ resolve, taskId })
    })
  }

  release(taskId: string): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      console.log(`[Adapter.Lock] Released by ${taskId}, passing to ${next.taskId}`)
      next.resolve()
    } else {
      this.locked = false
      console.log(`[Adapter.Lock] Released by ${taskId}, lock free`)
    }
  }

  get isLocked(): boolean {
    return this.locked
  }

  get queueLength(): number {
    return this.queue.length
  }
}

const MAX_RETRIES = 3
const CDP_RETRY_DELAY = 3000
const CDP_IDLE_DETACH_MS = 30_000

/** 设为 true 输出 DOM 诊断日志（调试 Runway 页面结构时启用） */
const ADAPTER_DEBUG = false

// ── 反封禁工具函数 ──

/** 延迟 + 随机抖动，掩盖自动化定时特征 */
function delay(ms: number, jitterPct = 0.3): Promise<void> {
  const jitter = ms * jitterPct
  const actual = ms + (Math.random() * 2 - 1) * jitter
  return new Promise((r) => setTimeout(r, Math.round(actual)))
}

/** 模拟人类点击间隔 (75ms ~ 225ms) */
function humanClickGap(): Promise<void> {
  return delay(150, 0.5)
}

/** 坐标加 ±3px 随机噪声，模拟真鼠标亚像素抖动 */
function jitterPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(x + (Math.random() - 0.5) * 6),
    y: Math.round(y + (Math.random() - 0.5) * 6),
  }
}

export class RunwayAdapter implements IRunwayAdapter {
  private browserView: BrowserView | null = null
  private lock = new AsyncLock()

  // ── 并发槽位 & 页面状态 ──
  private pageReady = false
  private currentModel = ''
  private runwaySlots = 0
  private readonly MAX_SLOTS = 2
  private monitorActive = false
  private monitorStarting: Promise<void> | null = null
  private slotOccupied: [boolean, boolean] = [false, false]
  private submittedTasks = new Map<string, { slot: number; submittedAt: number }>()
  private lastCompletionTime = 0
  private readonly COMPLETION_COOLDOWN_MS = 3_000
  private onComplete: ((taskId: string, result: GenerationResult) => void) | null = null
  private onSlotFreed: (() => void) | null = null

  // ── CDP 按需挂载 ──
  private cdpIdleTimer: ReturnType<typeof setTimeout> | null = null
  // ── Monitor 阻塞状态（DevTools 抢占 debugger）──
  private monitorBlocked = false
  private onMonitorBlocked: ((blocked: boolean) => void) | null = null

  setBrowserView(bv: BrowserView): void {
    // 先清理旧 BrowserView 的 debugger listener，再切换到新的
    const wasActive = this.monitorActive
    if (wasActive) {
      this.stopPersistentMonitor()
    }
    this.browserView = bv
    this.pageReady = false
    if (wasActive) {
      this.startPersistentMonitor().catch((err) => {
        logger.error('Adapter.Monitor', 'Failed to restart monitor after BrowserView swap', undefined, err instanceof Error ? err : undefined)
      })
    }
  }

  async acquireLock(): Promise<void> {
    const taskId = 'unknown'
    return this.lock.acquire(taskId)
  }

  releaseLock(): void {
    this.lock.release('unknown')
  }

  /** 获取锁，带 taskId 标识方便日志追踪 */
  async acquireLockForTask(taskId: string): Promise<void> {
    return this.lock.acquire(taskId)
  }

  releaseLockForTask(taskId: string): void {
    this.lock.release(taskId)
  }

  // ── 槽位 & 回调 ──

  getAvailableSlots(): number {
    return this.MAX_SLOTS - this.runwaySlots
  }

  hasSlot(): boolean {
    return this.runwaySlots < this.MAX_SLOTS
  }

  /**
   * 从数据库恢复槽位状态（进程重启后调用）。
   *
   * 必须在 TaskQueue.markOrphanedRunningTasks() 之前调用，
   * 否则 running 任务被标记为 failed 后计数会归零。
   *
   * 恢复后 RunwayAdapter 认为槽位仍被占用，防止新提交超出
   * Runway 服务端并发限制（仍在处理的上次会话提交任务）。
   */
  restoreSlotState(runningCount: number): void {
    if (runningCount <= 0) {
      logger.info('Adapter.Slot', 'No orphaned running tasks — slots start at 0')
      return
    }

    const previousSlots = this.runwaySlots
    const count = Math.min(runningCount, this.MAX_SLOTS)
    this.runwaySlots = count

    // 标记前 count 个槽位为已占用
    for (let i = 0; i < this.MAX_SLOTS; i++) {
      this.slotOccupied[i] = i < count
    }

    logger.warn(
      'Adapter.Slot',
      `Restored slot state from DB: ${count}/${this.MAX_SLOTS} slots occupied ` +
        `(was ${previousSlots}/${this.MAX_SLOTS}, ${runningCount} orphaned running tasks found)`,
    )
  }

  setCompletionCallback(cb: (taskId: string, result: GenerationResult) => void): void {
    this.onComplete = cb
  }

  setSlotFreedCallback(cb: () => void): void {
    this.onSlotFreed = cb
  }

  setMonitorBlockedCallback(cb: (blocked: boolean) => void): void {
    this.onMonitorBlocked = cb
  }

  // ── 并发提交：仅提交不等待 ──

  /**
   * 提交任务到 Runway 并立即返回。
   * 持锁时间仅 10-20s（页面交互），不等待视频生成完成。
   * 生成完成后由持久 CDP monitor 通过 setCompletionCallback 回调通知。
   */
  /** Seedance 模型族使用不同的 UI 交互模式（参考槽位上传、可编辑输入框） */
  private isSeedanceModel(modelId: string): boolean {
    return modelId === 'seedance-2' || modelId === 'seedance2.0Fast'
  }

  /**
   * 将参考图上传到 Runway 页面。
   *
   * 策略因模型而异：
   * - WAN 2.6 / Gen-4: 查找 "First Video Frame" 拖放区，模拟 DragEvent
   * - Seedance 2.0: 查找页面上的 <input type="file">，通过 CDP 注入文件
   */
  async uploadReferenceImages(imagePaths: string[], modelId: string): Promise<void> {
    if (imagePaths.length === 0) return

    const wc = this.getWebContents()
    const isSeedance = this.isSeedanceModel(modelId)

    if (isSeedance) {
      // ── Seedance 2.0: 点击参考槽 + CDP 文件注入 ──
      const dbg = wc.debugger
      const wasAttached = dbg.isAttached()

      try {
        if (!wasAttached) {
          dbg.attach('1.3')
        }

        // 诊断：打印全部 imagePaths 顺序（检查 DB 返回顺序是否正确）
        console.log(`[Adapter] Seedance upload: imagePaths order = [${imagePaths.map(p => p.split(/[/\\\\]/).pop()).join(', ')}]`)

        // 诊断：打印当前页面上的空槽位和已填充槽位的布局
        const slotLayout: string = await wc.executeJavaScript(`
          (function() {
            var result = [];
            // 空槽位
            var empties = document.querySelectorAll('div[class*="emptySlotContainer-"]');
            for (var e = 0; e < empties.length; e++) {
              if (empties[e].offsetParent === null) continue;
              var r = empties[e].getBoundingClientRect();
              result.push('EMPTY left=' + Math.round(r.left) + ' top=' + Math.round(r.top) + ' w=' + Math.round(r.width));
            }
            // 已填充槽位
            var filled = document.querySelectorAll('button[class*="slot-"][aria-label*="View IMG"]');
            for (var f = 0; f < filled.length; f++) {
              if (filled[f].offsetParent === null) continue;
              var fr = filled[f].getBoundingClientRect();
              var label = filled[f].getAttribute('aria-label') || '';
              result.push('FILLED left=' + Math.round(fr.left) + ' label=' + label);
            }
            // "+ References" 按钮
            var btns = document.querySelectorAll('button');
            for (var b = 0; b < btns.length; b++) {
              var t = (btns[b].textContent || '').trim();
              if (t.indexOf('+') >= 0 && t.indexOf('Reference') >= 0 && btns[b].offsetParent !== null) {
                var br = btns[b].getBoundingClientRect();
                result.push('ADD_REF left=' + Math.round(br.left) + ' top=' + Math.round(br.top));
              }
            }
            return JSON.stringify(result);
          })()
        `)
        console.log(`[Adapter] Seedance slot layout: ${slotLayout}`)

        for (let i = 0; i < imagePaths.length; i++) {
          const filePath = imagePaths[i]
          console.log(`[Adapter] Seedance ref ${i + 1}/${imagePaths.length}: ${filePath}`)

          // Step 1: 找到空槽位，按视觉位置（左→右）排序，点击第 i 个
          let addRefRetries = 0
          const clickResult: string = await wc.executeJavaScript(`
            (function() {
              var slotIdx = ${i};

              // 空槽位: <div class="emptySlotContainer-WL6MCG" data-variant="placeholder">
              //            <div class="slot-YWcSul empty-rQrgeh"></div>
              //          </div>
              var emptySlots = document.querySelectorAll(
                'div[class*="emptySlotContainer-"]'
              );
              // 过滤掉不可见的
              var visible = [];
              for (var s = 0; s < emptySlots.length; s++) {
                if (emptySlots[s].offsetParent !== null) visible.push(emptySlots[s]);
              }

              // 按视觉位置从左到右排序（关键：DOM 顺序 ≠ 视觉顺序）
              visible.sort(function(a, b) {
                return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
              });

              // "+ References" 按钮
              var addBtn = null;
              var allBtns = document.querySelectorAll('button');
              for (var b = 0; b < allBtns.length; b++) {
                var txt = (allBtns[b].textContent || '').trim();
                if (txt.indexOf('+') >= 0 && txt.indexOf('Reference') >= 0 && allBtns[b].offsetParent !== null) {
                  addBtn = allBtns[b];
                  break;
                }
              }

              if (visible.length === 0) return 'NO_UPLOAD_BUTTONS';

              // 如果槽不够，点 "+ References"
              if (slotIdx >= visible.length) {
                if (addBtn) {
                  var addR = addBtn.getBoundingClientRect();
                  addBtn.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true,
                    clientX: addR.left + addR.width/2, clientY: addR.top + addR.height/2, button: 0
                  }));
                  return 'ADD_REF_CLICKED';
                }
                slotIdx = visible.length - 1;
              }

              // 点击空槽位内的 slot div（实际响应点击的元素）
              var slot = visible[slotIdx];
              var clickTarget = slot.querySelector('[class*="slot-"]') || slot;
              var r = clickTarget.getBoundingClientRect();
              clickTarget.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true,
                clientX: r.left + r.width/2, clientY: r.top + r.height/2, button: 0
              }));

              return 'CLICKED:' + slotIdx + ' left=' + Math.round(r.left);
            })()
          `)
          console.log(`[Adapter] Seedance click: ${clickResult}`)

          // 如果点了 "+ References" 按钮，说明槽位不够，需要等待新槽出现后重试
          if (clickResult === 'ADD_REF_CLICKED') {
            addRefRetries++
            if (addRefRetries <= 3) {
              console.log(`[Adapter] Seedance: new slot requested, retry ${addRefRetries}/3`)
              await delay(1500)
              i-- // 重试当前图片（循环末尾 i++ 会回到原索引）
              continue
            }
            console.warn(`[Adapter] Seedance: add-ref retry limit exceeded, falling through`)
          }

          // 等待 DOM 更新（如果有新的 file input 出现）
          await delay(800)

          // Step 2: CDP 查找 file input 并注入文件
          const docResult = await dbg.sendCommand('DOM.getDocument', { depth: 0 })
          const rootNodeId: number = (docResult as any).root.nodeId

          const queryResult = await dbg.sendCommand('DOM.querySelectorAll', {
            nodeId: rootNodeId,
            selector: 'input[type="file"]',
          })
          const nodeIds: number[] = (queryResult as any).nodeIds || []

          if (nodeIds.length > 0) {
            // 使用最后一个 file input（通常是最新激活的参考槽对应的）
            const targetNodeId = nodeIds[nodeIds.length - 1]
            await dbg.sendCommand('DOM.setFileInputFiles', {
              files: [filePath],
              nodeId: targetNodeId,
            })
            console.log(`[Adapter] Seedance CDP: file injected on node ${targetNodeId}`)
            // DOM.setFileInputFiles 触发原生 change 事件，不再手动 dispatch 避免重复
          } else {
            console.warn(`[Adapter] Seedance: no file input found in DOM after click`)
          }

          // 随机间隔 4000-8000ms，等待 Runway React 完成上传→槽位状态变更，
          // 避免下一轮迭代时槽位状态未刷新导致顺序错乱
          const gap = 4000 + Math.floor(Math.random() * 4000)
          console.log(`[Adapter] Seedance: waiting ${gap}ms before next image`)
          await delay(gap)
        }
      } catch (err) {
        console.error('[Adapter] Seedance CDP upload error:', err)
      } finally {
        if (!wasAttached && dbg.isAttached()) {
          try { dbg.detach() } catch { /* ok */ }
        }
      }
    } else {
      // ── WAN 2.6 / Gen-4: 优先 CDP 文件注入 → 兜底 DragEvent ──
      // CDP DOM.setFileInputFiles 精准注入到单个 <input type="file">，
      // 避免 DragEvent 冒泡导致同一文件被多个 React 组件重复处理。
      const dbg = wc.debugger
      const wasAttached = dbg.isAttached()

      // CDP monitor 可能已 attach debugger — 直接复用，不重复 attach
      const needsAttach = !wasAttached
      let useCDP = false

      try {
        if (needsAttach) {
          dbg.attach('1.3')
        }

        // 查找 <input type="file">（React 拖放区通常有隐藏的 file input）
        const docResult = await dbg.sendCommand('DOM.getDocument', { depth: 0 })
        const rootNodeId: number = (docResult as any).root.nodeId
        const queryResult = await dbg.sendCommand('DOM.querySelectorAll', {
          nodeId: rootNodeId,
          selector: 'input[type="file"]',
        })
        const nodeIds: number[] = (queryResult as any).nodeIds || []
        useCDP = nodeIds.length > 0

        if (useCDP) {
          // ── CDP 路径（精准，每次只注入一个 input）──
          for (let i = 0; i < imagePaths.length; i++) {
            const filePath = imagePaths[i]
            console.log(`[Adapter] CDP uploading image ${i + 1}/${imagePaths.length}: ${filePath}`)

            // 每个 input 可能对应一个参考图槽位，按顺序注入
            const targetIdx = Math.min(i, nodeIds.length - 1)
            const targetNodeId = nodeIds[targetIdx]

            await dbg.sendCommand('DOM.setFileInputFiles', {
              files: [filePath],
              nodeId: targetNodeId,
            })
            console.log(`[Adapter] CDP: file injected on node ${targetNodeId}`)
            // DOM.setFileInputFiles 触发原生 change 事件，React 事件委托自动捕获，
            // 不再手动 dispatch 避免重复上传同一文件
            await delay(1000)
          }
        }
      } catch (err) {
        console.error('[Adapter] CDP upload error for non-Seedance, falling back to DragEvent:', err)
        useCDP = false
      } finally {
        if (needsAttach && dbg.isAttached()) {
          try { dbg.detach() } catch { /* ok */ }
        }
      }

      // ── 兜底：DragEvent 模拟（CDP 不可用或页面无 file input 时）──
      if (!useCDP) {
        for (let i = 0; i < imagePaths.length; i++) {
          const filePath = imagePaths[i]
          console.log(`[Adapter] DragEvent fallback image ${i + 1}/${imagePaths.length}: ${filePath}`)

          const uploaded: boolean = await wc.executeJavaScript(`
            (function() {
              var candidates = document.querySelectorAll(
                '[class*="FirstFrame"], [class*="first-frame"], ' +
                '[class*="upload-area"], [class*="Upload"], ' +
                '[class*="dropzone"], [class*="DropZone"]'
              );

              // 找到最外层候选元素（不被其他候选元素包含），
              // 避免 bubbles: true 导致嵌套祖先重复处理同一文件
              var target = null;
              for (var j = 0; j < candidates.length; j++) {
                var el = candidates[j];
                var nested = false;
                for (var k = 0; k < candidates.length; k++) {
                  if (j !== k && candidates[k].contains(el) && candidates[k] !== el) {
                    nested = true;
                    break;
                  }
                }
                if (!nested) {
                  target = el;
                  break;
                }
              }

              if (!target) {
                var all = document.querySelectorAll('*');
                for (var k = 0; k < all.length; k++) {
                  var txt = (all[k].textContent || '').trim();
                  if (txt === 'First Video Frame' && all[k].offsetParent !== null) {
                    target = all[k];
                    break;
                  }
                }
              }

              if (!target) return false;

              var dt = new DataTransfer();
              var fileName = ${JSON.stringify(filePath.split(/[/\\\\]/).pop() || 'image.png')};
              try {
                dt.items.add(new File([''], fileName, { type: 'image/png' }));
              } catch(e) {
                return false;
              }

              // 仅 dispatch drop（不 dispatch dragenter/dragover，避免重复触发文件处理）
              var ev = new DragEvent('drop', {
                bubbles: true, cancelable: true,
                dataTransfer: dt,
              });
              target.dispatchEvent(ev);
              return true;
            })()
          `)

          if (!uploaded) {
            console.warn(`[Adapter] Cannot upload image ${filePath} — Runway upload area not found in DOM`)
          }
          await delay(1000)
        }
      }
    }

    console.log(`[Adapter] Reference image upload complete: ${imagePaths.length} images`)
  }

  /** 选择视频时长。
   *  Seedance 2.0: 可编辑输入框（直接键入数字）
   *  其他模型: 下拉菜单选择 */
  async selectDuration(duration: number): Promise<void> {
    const wc = this.getWebContents()

    // Seedance 模型族使用可编辑输入框
    if (this.isSeedanceModel(this.currentModel)) {
      await this.selectDurationViaInput(duration)
      return
    }

    const target = `${duration}s`

    // 1. 尝试直接点击当前值（如 "5s" 按钮）
    let clicked: boolean = await wc.executeJavaScript(clickValueChipByTextJS(target))
    if (!clicked) {
      // 2. 尝试通过 Duration 标签定位
      clicked = await wc.executeJavaScript(clickSettingByLabelJS('Duration'))
      if (!clicked) {
        // 3. 兜底：查找页面上所有可能的 duration 控制
        clicked = await wc.executeJavaScript(`
          (function() {
            var all = document.querySelectorAll('button, [role="button"], [role="combobox"]');
            for (var i = 0; i < all.length; i++) {
              var t = (all[i].textContent || '').trim().toLowerCase();
              if (/^\\d+s$/.test(t) && all[i].offsetParent !== null) {
                all[i].click();
                return true;
              }
            }
            return false;
          })()
        `)
        if (!clicked) {
          console.log(`[Adapter] Duration control not found for ${target}, skipping`)
          return
        }
      }
    }

    // 等下拉展开
    await delay(800)

    // 诊断：抓取下拉中所有可见文本，确认 Runway 实际显示的格式
    const dropdownTexts: string = await wc.executeJavaScript(`
      (function() {
        var containers = document.querySelectorAll(
          '[role="listbox"], [role="menu"], ' +
          '[class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], ' +
          '[class*="menu"], [class*="Menu"], [class*="panel"], [class*="Panel"]'
        );
        var texts = [];
        for (var c = 0; c < containers.length; c++) {
          if (containers[c].offsetParent === null) continue;
          var items = containers[c].querySelectorAll('*');
          for (var i = 0; i < items.length; i++) {
            if (items[i].offsetParent === null) continue;
            var t = (items[i].textContent || '').trim();
            if (t.length > 0 && t.length < 30 && items[i].children.length === 0) {
              texts.push(t);
            }
          }
        }
        return JSON.stringify([...new Set(texts)]);
      })()
    `)
    console.log(`[Adapter] Duration dropdown visible texts for target="${target}":`, dropdownTexts)

    // 查找下拉中匹配选项的坐标，用 OS 级点击（React SPA 更可靠）
    // 匹配多种可能格式: "10s" / "10 sec" / "10 seconds" / "10"
    const optionCoords: string = await wc.executeJavaScript(`
      (function() {
        var dur = ${duration};
        var patterns = [dur + 's', dur + ' sec', dur + ' seconds', String(dur)];
        var containers = document.querySelectorAll(
          '[role="listbox"], [role="menu"], ' +
          '[class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], ' +
          '[class*="menu"], [class*="Menu"], [class*="panel"], [class*="Panel"]'
        );
        var searchRoots = containers.length > 0 ? containers : [document.body];
        for (var c = 0; c < searchRoots.length; c++) {
          if (searchRoots[c].offsetParent === null && searchRoots[c] !== document.body) continue;
          var items = searchRoots[c].querySelectorAll('*');
          for (var i = 0; i < items.length; i++) {
            var el = items[i];
            if (el.offsetParent === null) continue;
            var t = (el.textContent || '').trim().toLowerCase();
            for (var p = 0; p < patterns.length; p++) {
              if (t === patterns[p]) {
                var r = el.getBoundingClientRect();
                return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
              }
            }
          }
        }
        return null;
      })()
    `)

    if (optionCoords) {
      const oc = JSON.parse(optionCoords)
      const p1 = jitterPoint(oc.x, oc.y)
      const p2 = jitterPoint(oc.x, oc.y)
      wc.sendInputEvent({ type: 'mouseDown', x: p1.x, y: p1.y, button: 'left', clickCount: 1 })
      await humanClickGap()
      wc.sendInputEvent({ type: 'mouseUp', x: p2.x, y: p2.y, button: 'left', clickCount: 1 })
      console.log(`[Adapter] Duration option ${target} clicked at (${oc.x}, ${oc.y})`)
    } else {
      console.log(`[Adapter] Duration option ${target} not found in dropdown`)
    }
    console.log(`[Adapter] Duration set to ${target}`)
    await delay(300)
  }

  /** Seedance 2.0 可编辑输入框：点击聚焦 → 原生 setter 设值 → 派发 React 事件 */
  private async selectDurationViaInput(duration: number): Promise<void> {
    const wc = this.getWebContents()
    const target = String(duration)

    // Step 1: 点击 Duration 触发按钮，展开时长面板
    // DOM: <button aria-label="Duration"><span class="durationTriggerText-...">5s</span></button>
    const triggered: boolean = await wc.executeJavaScript(`
      (function() {
        var btn = document.querySelector('button[aria-label="Duration"]');
        if (!btn || btn.offsetParent === null) {
          var all = document.querySelectorAll('button');
          for (var i = 0; i < all.length; i++) {
            if ((all[i].getAttribute('aria-label') || '').toLowerCase() === 'duration') {
              btn = all[i];
              break;
            }
          }
        }
        if (!btn || btn.offsetParent === null) return false;
        btn.click();
        return true;
      })()
    `)

    if (!triggered) {
      console.log(`[Adapter] Seedance duration trigger not found, falling back to dropdown`)
      await this.selectDurationFallback(duration)
      return
    }

    console.log(`[Adapter] Seedance duration panel triggered`)

    // 等待面板展开 + Slider 渲染
    await delay(600)

    // Step 2: 直接在 Radix Slider 轨道上点击对应秒数的位置
    // Slider: role="slider" aria-valuemin="4" aria-valuemax="15" aria-valuenow="14"
    // 不依赖 input 输入框，直接操作 slider（Runway 的主要时长控件）
    const success: boolean = await wc.executeJavaScript(`
      (function() {
        var target = ${duration};
        var slider = document.querySelector('[role="slider"]');
        if (!slider || slider.offsetParent === null) return false;

        var min = parseInt(slider.getAttribute('aria-valuemin')) || 4;
        var max = parseInt(slider.getAttribute('aria-valuemax')) || 15;
        var clamped = Math.max(min, Math.min(max, target));
        var percent = (clamped - min) / (max - min);

        // 在 Slider 轨道上找到可点击的区域（Track 或 Root）
        var track = slider.closest('[class*="Slider__Root"]') ||
                    slider.closest('[class*="Slider__Track"]') ||
                    slider.parentElement;
        if (!track) return false;

        var rect = track.getBoundingClientRect();
        var x = rect.left + rect.width * percent;
        var y = rect.top + rect.height / 2;

        // Radix Slider 响应 pointer 事件（非 mouse 事件）
        ['pointerdown', 'pointerup'].forEach(function(type) {
          track.dispatchEvent(new PointerEvent(type, {
            clientX: x, clientY: y, bubbles: true, cancelable: true,
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0
          }));
        });

        // 验证：读取 aria-valuenow 确认值已更新
        var newVal = parseInt(slider.getAttribute('aria-valuenow')) || 0;
        return newVal === clamped;
      })()
    `)

    console.log(`[Adapter] Seedance duration set to ${target}s (success=${success})`)

    if (!success) {
      console.log(`[Adapter] Seedance duration slider failed, falling back to dropdown`)
      await this.selectDurationFallback(duration)
    }

    // Step 3: 关闭 Duration 面板（否则会遮挡后续的 prompt 输入和图片上传）
    // Radix Popover 通过监听 document pointerdown 来检测点击外部并关闭
    await wc.executeJavaScript(`
      (function() {
        // 策略 A: 再次点击 Duration 按钮，利用 toggle 行为关闭面板
        var btn = document.querySelector('button[aria-label="Duration"]');
        if (btn && btn.offsetParent !== null) {
          btn.click();
          return;
        }
      })()
    `)
    await delay(150)

    // 兜底：模拟点击面板外部，触发 Radix DismissableLayer
    await wc.executeJavaScript(`
      (function() {
        // 在 body 左上角派发 pointerdown（远离 popover 区域），
        // Radix 的 onInteractOutside 会捕获并关闭 popover
        document.body.dispatchEvent(new PointerEvent('pointerdown', {
          clientX: 1, clientY: 1, bubbles: true, cancelable: true,
          pointerId: 99, pointerType: 'mouse', isPrimary: true, button: 0
        }));
        document.body.dispatchEvent(new PointerEvent('pointerup', {
          clientX: 1, clientY: 1, bubbles: true, cancelable: true,
          pointerId: 99, pointerType: 'mouse', isPrimary: true, button: 0
        }));
      })()
    `)
    await delay(200)
  }

  /** 兜底：当 Seedance input 模式找不到输入框时，走原下拉逻辑 */
  private async selectDurationFallback(duration: number): Promise<void> {
    const wc = this.getWebContents()
    const target = `${duration}s`

    let clicked: boolean = await wc.executeJavaScript(clickValueChipByTextJS(target))
    if (!clicked) {
      clicked = await wc.executeJavaScript(clickSettingByLabelJS('Duration'))
    }
    if (!clicked) {
      console.log(`[Adapter] Duration fallback: control not found for ${target}`)
      return
    }

    await delay(800)
    const optionCoords: string = await wc.executeJavaScript(`
      (function() {
        var dur = ${duration};
        var patterns = [dur + 's', dur + ' sec', dur + ' seconds', String(dur)];
        var containers = document.querySelectorAll(
          '[role="listbox"], [role="menu"], ' +
          '[class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], ' +
          '[class*="menu"], [class*="Menu"], [class*="panel"], [class*="Panel"]'
        );
        var roots = containers.length > 0 ? containers : [document.body];
        for (var c = 0; c < roots.length; c++) {
          if (roots[c].offsetParent === null && roots[c] !== document.body) continue;
          var items = roots[c].querySelectorAll('*');
          for (var i = 0; i < items.length; i++) {
            if (items[i].offsetParent === null) continue;
            var t = (items[i].textContent || '').trim().toLowerCase();
            for (var p = 0; p < patterns.length; p++) {
              if (t === patterns[p]) {
                var r = items[i].getBoundingClientRect();
                return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
              }
            }
          }
        }
        return null;
      })()
    `)
    if (optionCoords) {
      const oc = JSON.parse(optionCoords)
      const p1 = jitterPoint(oc.x, oc.y)
      const p2 = jitterPoint(oc.x, oc.y)
      wc.sendInputEvent({ type: 'mouseDown', x: p1.x, y: p1.y, button: 'left', clickCount: 1 })
      await humanClickGap()
      wc.sendInputEvent({ type: 'mouseUp', x: p2.x, y: p2.y, button: 'left', clickCount: 1 })
      console.log(`[Adapter] Duration fallback: ${target} clicked via OS event`)
    }
    await delay(300)
  }

  /** 选择视频分辨率。策略同 selectDuration。 */
  async selectResolution(resolution: string): Promise<void> {
    const wc = this.getWebContents()

    // 1. 直接点击当前值
    let clicked: boolean = await wc.executeJavaScript(clickValueChipByTextJS(resolution))
    if (!clicked) {
      // 2. 通过 Resolution 标签定位
      clicked = await wc.executeJavaScript(clickSettingByLabelJS('Resolution'))
      if (!clicked) {
        // 3. 兜底：查找页面上可能的 resolution 控制
        clicked = await wc.executeJavaScript(`
          (function() {
            var all = document.querySelectorAll('button, [role="button"], [role="combobox"]');
            for (var i = 0; i < all.length; i++) {
              var t = (all[i].textContent || '').trim();
              if (/^(480p|720p|1080p|2K|4K)$/i.test(t) && all[i].offsetParent !== null) {
                all[i].click();
                return true;
              }
            }
            return false;
          })()
        `)
        if (!clicked) {
          console.log(`[Adapter] Resolution control not found for ${resolution}, skipping`)
          return
        }
      }
    }

    // 等下拉展开，用 OS 级点击选项
    await delay(800)
    const optionCoords: string = await wc.executeJavaScript(`
      (function() {
        var target = ${JSON.stringify(resolution)};
        var containers = document.querySelectorAll(
          '[role="listbox"], [role="menu"], ' +
          '[class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], ' +
          '[class*="menu"], [class*="Menu"], [class*="panel"], [class*="Panel"]'
        );
        var searchRoots = containers.length > 0 ? containers : [document.body];
        for (var c = 0; c < searchRoots.length; c++) {
          if (searchRoots[c].offsetParent === null && searchRoots[c] !== document.body) continue;
          var items = searchRoots[c].querySelectorAll('*');
          for (var i = 0; i < items.length; i++) {
            var el = items[i];
            if (el.offsetParent === null) continue;
            if ((el.textContent || '').trim() === target) {
              var r = el.getBoundingClientRect();
              return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
            }
          }
        }
        return null;
      })()
    `)
    if (optionCoords) {
      const oc = JSON.parse(optionCoords)
      const p1 = jitterPoint(oc.x, oc.y)
      const p2 = jitterPoint(oc.x, oc.y)
      wc.sendInputEvent({ type: 'mouseDown', x: p1.x, y: p1.y, button: 'left', clickCount: 1 })
      await humanClickGap()
      wc.sendInputEvent({ type: 'mouseUp', x: p2.x, y: p2.y, button: 'left', clickCount: 1 })
    }
    console.log(`[Adapter] Resolution set to ${resolution}`)
    await delay(300)
  }

  /** 选择画面比例。策略同 selectDuration。 */
  async selectAspectRatio(ratio: string): Promise<void> {
    const wc = this.getWebContents()

    // 1. 直接点击当前值
    let clicked: boolean = await wc.executeJavaScript(clickValueChipByTextJS(ratio))
    if (!clicked) {
      // 2. 通过 "Aspect ratio" 标签定位
      clicked = await wc.executeJavaScript(clickSettingByLabelJS('Aspect ratio'))
      if (!clicked) {
        // 3. 兜底：查找比例格式的值
        clicked = await wc.executeJavaScript(`
          (function() {
            var all = document.querySelectorAll('button, [role="button"], [role="combobox"]');
            for (var i = 0; i < all.length; i++) {
              var t = (all[i].textContent || '').trim();
              if (/^\\d+:\\d+$/.test(t) && all[i].offsetParent !== null) {
                all[i].click();
                return true;
              }
            }
            return false;
          })()
        `)
        if (!clicked) {
          console.log(`[Adapter] Aspect ratio control not found for ${ratio}, skipping`)
          return
        }
      }
    }

    // 等下拉展开，用 OS 级点击选项
    await delay(800)
    const optionCoords: string = await wc.executeJavaScript(`
      (function() {
        var target = ${JSON.stringify(ratio)};
        var containers = document.querySelectorAll(
          '[role="listbox"], [role="menu"], ' +
          '[class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], ' +
          '[class*="menu"], [class*="Menu"], [class*="panel"], [class*="Panel"]'
        );
        var searchRoots = containers.length > 0 ? containers : [document.body];
        for (var c = 0; c < searchRoots.length; c++) {
          if (searchRoots[c].offsetParent === null && searchRoots[c] !== document.body) continue;
          var items = searchRoots[c].querySelectorAll('*');
          for (var i = 0; i < items.length; i++) {
            var el = items[i];
            if (el.offsetParent === null) continue;
            if ((el.textContent || '').trim() === target) {
              var r = el.getBoundingClientRect();
              return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
            }
          }
        }
        return null;
      })()
    `)
    if (optionCoords) {
      const oc = JSON.parse(optionCoords)
      const p1 = jitterPoint(oc.x, oc.y)
      const p2 = jitterPoint(oc.x, oc.y)
      wc.sendInputEvent({ type: 'mouseDown', x: p1.x, y: p1.y, button: 'left', clickCount: 1 })
      await humanClickGap()
      wc.sendInputEvent({ type: 'mouseUp', x: p2.x, y: p2.y, button: 'left', clickCount: 1 })
    }
    console.log(`[Adapter] Aspect ratio set to ${ratio}`)
    await delay(300)
  }

  async submitOnly(taskId: string, modelId: string, prompt: string, imagePaths?: string[], duration?: number, resolution?: string, aspectRatio?: string): Promise<void> {
    // 防超发保护（worker loop 已做槽位检查，此处在极端竞态下兜底）
    if (this.runwaySlots >= this.MAX_SLOTS) {
      throw new Error(`Runway slots full (${this.runwaySlots}/${this.MAX_SLOTS}) — task should have been queued`)
    }

    // 分配槽位（立即生效，防止队列重复取任务）
    let assignedSlot = -1
    if (!this.slotOccupied[0]) assignedSlot = 0
    else if (!this.slotOccupied[1]) assignedSlot = 1
    if (assignedSlot === -1) {
      throw new Error(`Runway slots full (${this.runwaySlots}/${this.MAX_SLOTS}) — task should have been queued`)
    }
    this.slotOccupied[assignedSlot] = true
    this.runwaySlots++
    logger.info(
      'Adapter.Slot',
      `Slot ${assignedSlot} acquired — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`,
      taskId,
    )

    try {
      if (!this.monitorActive) {
        console.log('[Adapter] CDP monitor not active, attempting restart...')
        await this.startPersistentMonitor()
        if (!this.monitorActive) {
          throw new Error('CDP monitor unavailable — cannot track generation completion')
        }
      }

      await this.acquireLockForTask(taskId)
      try {
        const wc = this.getWebContents()

        // 1. 页面初始化（仅首次或 BrowserView 重建后）
        if (!this.pageReady) {
          console.log('[Adapter] Page not ready, running resetPage...')
          await this.resetPage()
          this.pageReady = true
        }

        // 2. 模型切换（仅在模型变化时）
        if (this.currentModel !== modelId) {
          console.log(`[Adapter] Switching model: ${this.currentModel || 'none'} → ${modelId}`)
          await this.selectModel(modelId)
          this.currentModel = modelId
        }

        // 3. 配置视频参数（时长/分辨率/比例）
        if (duration !== undefined) {
          await this.selectDuration(duration)
        }
        if (resolution !== undefined) {
          await this.selectResolution(resolution)
        }
        if (aspectRatio !== undefined) {
          await this.selectAspectRatio(aspectRatio)
        }

        // 4. 填充提示词（先于图片上传，避免图片上传后 DOM 状态变化干扰）
        await this.fillPrompt(prompt)
        console.log('[Adapter] submitOnly: fillPrompt done, calling uploadRefs...')

        // 5. 上传参考图（如有）
        if (imagePaths && imagePaths.length > 0) {
          await this.uploadReferenceImages(imagePaths, modelId)
        }

        // 6. 点击生成（内部含 session 配置逻辑）
        await this.clickGenerate()

        // 重置页面状态，下一个任务会在 resetPage 中 reload 页面
        // Runway 的生成是服务端的，reload 不会取消已提交的生成
        this.pageReady = false
        this.currentModel = ''

        // 记录提交到 CDP monitor 的匹配队列
        this.submittedTasks.set(taskId, { slot: assignedSlot, submittedAt: Date.now() })
        logger.info(
          'Adapter.Slot',
          `Task submitted on slot ${assignedSlot} — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`,
          taskId,
        )
      } finally {
        this.releaseLockForTask(taskId)
      }
    } catch (err) {
      // 提交失败，释放槽位
      this.slotOccupied[assignedSlot] = false
      this.runwaySlots = Math.max(0, this.runwaySlots - 1)
      logger.warn(
        'Adapter.Slot',
        `Slot ${assignedSlot} released (submission failed) — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`,
        taskId,
      )
      throw err
    }
  }

  // ── 持久 CDP Monitor ──

  /**
   * 启动持久 CDP 网络监听器。
   * 应用启动时调用一次，持续监听所有网络响应直到应用退出。
   * 检测到视频生成完成时调用 onComplete 回调，
   * 检测到任一完成时调用 onSlotFreed 回调。
   */
  async startPersistentMonitor(): Promise<void> {
    if (this.monitorActive) return
    if (!this.browserView) return // BrowserView 已被销毁，无需 monitor
    if (this.monitorStarting) {
      logger.info('Adapter.Monitor', 'Startup already in progress, waiting...')
      await this.monitorStarting
      return
    }

    this.monitorStarting = this._doStartMonitor()
    try {
      await this.monitorStarting
    } finally {
      this.monitorStarting = null
    }
  }

  private async _doStartMonitor(): Promise<void> {
    const wc = this.getWebContents()
    const dbg = wc.debugger

    // 预先注册 detach 监听器（防止重复注册），确保在 isAttached() 检查之前就绪。
    // 这样即使 DevTools 抢占 debugger，detach 事件也会触发并回调 _doStartMonitor 重连。
    dbg.removeListener('detach', this.onDetach)
    dbg.on('detach', this.onDetach)

    if (dbg.isAttached()) {
      // DevTools 或其他调试器正在占用 CDP 会话。
      // 不启用退避重连 —— 只需等待 detach 事件。
      this.monitorBlocked = true
      this.monitorActive = false
      logger.warn('Adapter.Monitor', 'CDP blocked — DevTools or another debugger is holding the session. Monitoring paused until detach.')
      this.onMonitorBlocked?.(true)
      return
    }

    try {
      dbg.attach('1.3')
      await dbg.sendCommand('Network.enable')
      this.monitorActive = true
      this.monitorReconnectAttempts = 0

      // 如果之前处于阻塞状态，通知恢复
      if (this.monitorBlocked) {
        this.monitorBlocked = false
        logger.info('Adapter.Monitor', 'CDP monitor restored after unblock')
        this.onMonitorBlocked?.(false)
      }

      logger.info('Adapter.Monitor', 'Persistent CDP monitor started')
      // 持久消息处理器
      dbg.on('message', this.persistentMessageHandler)
    } catch (err) {
      logger.error('Adapter.Monitor', 'Failed to start CDP monitor', undefined, err instanceof Error ? err : undefined)
      this.monitorActive = false
      this.reattachMonitor()
    }
  }

  private onDetach = (_event: Electron.Event, reason: string): void => {
    logger.warn('Adapter.Monitor', `CDP detached: ${reason}`)
    this.monitorActive = false

    if (this.monitorBlocked) {
      // DevTools 关闭 —— 立即重连，不等待退避
      this.clearReconnectTimer()
      this.monitorBlocked = false
      logger.info('Adapter.Monitor', 'DevTools closed, attempting immediate reconnect')
      this.onMonitorBlocked?.(false)
      this._doStartMonitor().catch((err) => {
        logger.error('Adapter.Monitor', 'Immediate reconnect after unblock failed', undefined, err instanceof Error ? err : undefined)
        this.reattachMonitor()
      })
    } else {
      // 正常 detach（空闲超时、crash 等）—— 使用退避重连
      this.reattachMonitor()
    }
  }

  private monitorReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private monitorReconnectAttempts = 0
  private readonly MONITOR_MAX_RECONNECT_ATTEMPTS = 10

  private clearReconnectTimer(): void {
    if (this.monitorReconnectTimer) {
      clearTimeout(this.monitorReconnectTimer)
      this.monitorReconnectTimer = null
    }
  }

  private reattachMonitor(): void {
    if (this.monitorReconnectTimer) return
    if (this.monitorReconnectAttempts >= this.MONITOR_MAX_RECONNECT_ATTEMPTS) {
      logger.error('Adapter.Monitor', `Giving up reconnection after ${this.MONITOR_MAX_RECONNECT_ATTEMPTS} attempts`)
      return
    }
    this.monitorReconnectAttempts++
    const delay = Math.min(5000 * Math.pow(2, this.monitorReconnectAttempts - 1), 60000)
    logger.warn('Adapter.Monitor', `Reconnect attempt ${this.monitorReconnectAttempts}/${this.MONITOR_MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s`)
    this.monitorReconnectTimer = setTimeout(async () => {
      this.monitorReconnectTimer = null
      try {
        await this.startPersistentMonitor()
        if (this.monitorActive) {
          this.monitorReconnectAttempts = 0
          logger.info('Adapter.Monitor', 'Reconnected')
        }
      } catch {
        this.reattachMonitor()
      }
    }, delay)
  }

  stopPersistentMonitor(): void {
    this.cancelCdpDetach()
    this.clearReconnectTimer()
    this.monitorActive = false
    this.monitorBlocked = false
    this.monitorStarting = null
    this.monitorReconnectAttempts = 0
    // BrowserView 可能已被 destroy（窗口关闭早于 before-quit）
    if (!this.browserView) {
      logger.info('Adapter.Monitor', 'BrowserView already destroyed, skip cleanup')
      return
    }
    try {
      const wc = this.getWebContents()
      wc.debugger.removeListener('detach', this.onDetach)
      wc.debugger.removeListener('message', this.persistentMessageHandler)
      if (wc.debugger.isAttached()) {
        wc.debugger.detach()
      }
      logger.info('Adapter.Monitor', 'Stopped')
    } catch { /* already detached */ }
  }

  /** 有新任务活跃时调用：取消闲置 detach 定时，确保 CDP attach */
  notifyTaskActive(): void {
    this.cancelCdpDetach()
    if (!this.monitorActive) {
      this.startPersistentMonitor().catch((err) => {
        logger.error('Adapter.Monitor', 'notifyTaskActive start failed', undefined, err instanceof Error ? err : undefined)
      })
    }
  }

  /** 任务完成时调用：启动 30s CDP detach 倒计时 */
  notifyTaskIdle(): void {
    if (this.cdpIdleTimer) return // 已有定时
    logger.info('Adapter.Monitor', `Scheduling CDP detach in ${CDP_IDLE_DETACH_MS / 1000}s`)
    this.cdpIdleTimer = setTimeout(() => {
      this.cdpIdleTimer = null
      if (this.submittedTasks.size === 0) {
        logger.info('Adapter.Monitor', 'Idle timeout, detaching CDP')
        this._doDetach()
      }
    }, CDP_IDLE_DETACH_MS)
  }

  private cancelCdpDetach(): void {
    if (this.cdpIdleTimer) {
      clearTimeout(this.cdpIdleTimer)
      this.cdpIdleTimer = null
      logger.info('Adapter.Monitor', 'Cancelled idle detach')
    }
  }

  /** 仅 detach CDP，不清理 listener（保留 reattach 能力） */
  private _doDetach(): void {
    this.monitorActive = false
    if (!this.browserView) return
    try {
      const wc = this.getWebContents()
      if (wc.debugger.isAttached()) {
        wc.debugger.detach()
        logger.info('Adapter.Monitor', 'CDP detached (idle)')
      }
    } catch { /* already detached */ }
  }

  /** 持久消息处理器：拦截视频 asset 和 API 完成响应 */
  private persistentMessageHandler = async (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    if (method !== 'Network.responseReceived') return

    const response = (params.response as Record<string, unknown>) || {}
    const url: string = (response.url as string) || ''
    const mimeType: string = (response.mimeType as string) || ''
    const status: number = (response.status as number) || 0

    // ── 信号 1：视频文件直接加载 ──
    if (mimeType.startsWith('video/') || /\.(mp4|webm|mov)(\?|$)/i.test(url)) {
      logger.info('Adapter.Monitor', `Video asset detected: ${url}`)
      await this.handleMonitorCompletion(url)
      return
    }

    // ── 信号 2：Runway API 生成任务完成 ──
    if (status === 200 && /generation|task|asset|output|job/i.test(url)) {
      try {
        const wc = this.getWebContents()
        const dbg = wc.debugger
        const { body, base64Encoded } = await dbg.sendCommand(
          'Network.getResponseBody',
          { requestId: params.requestId as string },
        ) as { body: string; base64Encoded: boolean }

        const text = base64Encoded
          ? Buffer.from(body, 'base64').toString('utf-8')
          : body

        let data: Record<string, unknown>
        try { data = JSON.parse(text) } catch { return }

        const taskStatus = (data.status || data.state || '') as string

        if (/succeeded|completed|done|ready/i.test(taskStatus)) {
          const videoUrl = (data.video_url || data.url || data.output_url ||
            data.asset_url || data.result?.url || '') as string
          console.log('[Adapter.Monitor] API completion:', taskStatus, videoUrl || '(no url)')
          await this.handleMonitorCompletion(videoUrl || undefined)
        } else if (/failed|error|cancelled/i.test(taskStatus)) {
          console.log('[Adapter.Monitor] API failure:', taskStatus)
          await this.handleMonitorFailure(data.error || data.message || taskStatus)
        }
      } catch {
        // getResponseBody 可能失败（流式响应），忽略
      }
    }
  }

  /** 处理 monitor 检测到的完成事件：按槽位匹配已提交的任务 */
  private async handleMonitorCompletion(videoUrl?: string): Promise<void> {
    if (this.submittedTasks.size === 0) {
      // 没有活跃任务但有槽位被占用 → 说明槽位是进程重启后从 DB 恢复的，
      // 此次完成事件对应上次会话提交的遗留任务。释放一个槽位。
      if (this.runwaySlots > 0) {
        this.freeOrphanedSlot('completed')
      }
      console.log('[Adapter.Monitor] Completion detected but no active tasks')
      return
    }
    // 去重：同一生成完成会触发视频加载 + API 响应两个 CDP 事件，冷却窗口内忽略重复
    const now = Date.now()
    if (now - this.lastCompletionTime < this.COMPLETION_COOLDOWN_MS) {
      console.log('[Adapter.Monitor] Skipping duplicate completion event (within cooldown)')
      return
    }
    this.lastCompletionTime = now

    const taskId = await this.matchCompletionToTask()
    if (!taskId) {
      console.log('[Adapter.Monitor] Could not match completion to any task')
      return
    }

    const entry = this.submittedTasks.get(taskId)!
    this.submittedTasks.delete(taskId)
    this.slotOccupied[entry.slot] = false
    this.runwaySlots = Math.max(0, this.runwaySlots - 1)
    logger.info(
      'Adapter.Slot',
      `Slot ${entry.slot} freed (completed) — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`,
      taskId,
    )

    if (this.onComplete) {
      this.onComplete(taskId, { status: 'completed', videoUrl })
    }
    if (this.onSlotFreed) {
      this.onSlotFreed()
    }
  }

  private lastFailureTime = 0

  private async handleMonitorFailure(errorMsg: unknown): Promise<void> {
    if (this.submittedTasks.size === 0) {
      // 没有活跃任务但有槽位被占用 → 说明槽位是进程重启后从 DB 恢复的，
      // 此次失败事件对应上次会话提交的遗留任务。释放一个槽位。
      if (this.runwaySlots > 0) {
        this.freeOrphanedSlot('failed')
      }
      return
    }
    const now = Date.now()
    if (now - this.lastFailureTime < 3000) {
      console.log('[Adapter.Monitor] Skipping duplicate failure event (within cooldown)')
      return
    }
    this.lastFailureTime = now

    const taskId = await this.matchCompletionToTask()
    if (!taskId) return

    const entry = this.submittedTasks.get(taskId)!
    this.submittedTasks.delete(taskId)
    this.slotOccupied[entry.slot] = false
    this.runwaySlots = Math.max(0, this.runwaySlots - 1)
    logger.error(
      'Adapter.Slot',
      `Slot ${entry.slot} freed (failed) — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`,
      taskId,
    )

    if (this.onComplete) {
      this.onComplete(taskId, { status: 'failed', error: String(errorMsg) })
    }
    if (this.onSlotFreed) {
      this.onSlotFreed()
    }
  }

  /**
   * 释放一个从 DB 恢复的孤儿槽位（无对应 submittedTasks 条目）。
   * 进程重启后 CDP monitor 检测到上次会话的遗留任务完成/失败时调用。
   */
  private freeOrphanedSlot(reason: 'completed' | 'failed'): void {
    // 找到第一个被占用的槽位并释放
    for (let i = 0; i < this.MAX_SLOTS; i++) {
      if (this.slotOccupied[i]) {
        this.slotOccupied[i] = false
        this.runwaySlots = Math.max(0, this.runwaySlots - 1)
        logger.info(
          'Adapter.Slot',
          `Orphaned slot ${i} freed (${reason}) — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`,
        )
        if (this.onSlotFreed) {
          this.onSlotFreed()
        }
        return
      }
    }
    // 防御：slotOccupied 都为 false 但 runwaySlots > 0（数据不一致）
    if (this.runwaySlots > 0) {
      logger.warn(
        'Adapter.Slot',
        `Inconsistent slot state: runwaySlots=${this.runwaySlots} but all slotOccupied are false — resetting`,
      )
      this.runwaySlots = 0
      this.slotOccupied = [false, false]
    }
  }

  /**
   * 将 CDP 检测到的完成事件匹配到具体任务。
   * 只有 1 个活跃任务时直接匹配；2 个活跃任务时通过 Runway 页面 UI 判断
   * 哪个槽位刚完成，UI 检查失败时回退到 FIFO。
   */
  private async matchCompletionToTask(): Promise<string | null> {
    const entries = [...this.submittedTasks.entries()]
    if (entries.length === 0) return null
    if (entries.length === 1) return entries[0][0]

    // 2 个任务活跃：通过 UI 分辨哪个槽位已完成
    // 策略：查询 Runway 页面生成列表中每个项的完成状态
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const wc = this.getWebContents()
        const completedSlot: number | null = await wc.executeJavaScript(`
          (function() {
            // 查找所有生成条目（Runway 通常用卡片/列表项展示生成历史）
            // 已完成的有 video/download 按钮，进行中的有 progress 条
            var items = document.querySelectorAll(
              '[class*="Generation"], [class*="generation"], ' +
              '[class*="AssetItem"], [class*="assetItem"], ' +
              '[class*="HistoryItem"], [class*="historyItem"], ' +
              '[data-testid*="generation"], [data-testid*="asset"]'
            );
            if (items.length === 0) {
              // 回退：找所有包含 video 或 progress 的容器
              items = document.querySelectorAll(
                'video, [class*="progress"], [class*="Progress"], ' +
                '[class*="status"], [class*="Status"], progress, [role="progressbar"]'
              );
            }
            // 检查每个条目的状态
            var completions = 0;
            for (var i = 0; i < items.length; i++) {
              var el = items[i];
              if (el.offsetParent === null) continue;
              var inner = el.innerHTML || '';
              var text = (el.textContent || '').toLowerCase();
              // 完成标记
              if (el.tagName === 'VIDEO' || inner.indexOf('<video') > -1 ||
                  text.indexOf('download') > -1 || text.indexOf('下载') > -1) {
                completions++;
              }
            }
            return completions;
          })()
        `)
        // 如果检测到 1 个完成，用 slot 0（先提交的）对应的任务
        // 如果检测到 2 个完成，两个都完成了，用 FIFO
        if (typeof completedSlot === 'number' && completedSlot >= 1) {
          // 至少有 1 个完成，用 FIFO（先提交的先完成是最常见情况）
          break
        }
        // UI 还没更新，等 1 秒重试
        await delay(1000)
      } catch {
        await delay(500)
      }
    }

    // 回退：FIFO — 更早提交的更可能先完成
    const sorted = entries.sort((a, b) => a[1].submittedAt - b[1].submittedAt)
    console.log(`[Adapter.Monitor] 2 tasks active, FIFO fallback — matched ${sorted[0][0].slice(0, 8)}`)
    return sorted[0][0]
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = MAX_RETRIES,
  ): Promise<T> {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn()
      } catch (err) {
        if (i === maxRetries) throw err
        const delay = Math.pow(2, i) * 1000
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    throw new Error('unreachable')
  }

  private getWebContents() {
    if (!this.browserView) {
      throw new Error('BrowserView not set. Call setBrowserView() before using Adapter.')
    }
    return this.browserView.webContents
  }

  /** 重置 Runway 页面到干净状态。reload 不会取消服务端已提交的生成。 */
  async resetPage(): Promise<void> {
    const wc = this.getWebContents()

    const currentUrl = wc.getURL()
    if (!currentUrl || currentUrl === 'about:blank') {
      try {
        await wc.loadURL(getRunwayURL())
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('ERR_ABORTED')) {
          console.log('[Adapter] loadURL aborted (expected due to client-side redirect), continuing...')
        } else {
          throw err
        }
      }
      await this.waitForReady(15_000)
    } else {
      console.log('[Adapter] Reloading page for clean state')
      wc.reload()
      await this.waitForReady(20_000)
    }

    // 等待 React 组件水合完成（模型下拉按钮 + 提示词输入框均可见）
    const dropdownFound = await this.waitForSelector(RUNWAY_SELECTORS.modelDropdown, 20_000)
    if (!dropdownFound) throw new Error('Page did not load properly after reset — model dropdown missing')

    const promptFound = await this.waitForSelector(RUNWAY_SELECTORS.promptInput, 15_000)
    if (!promptFound) throw new Error('Page did not load properly after reset — prompt input missing')

    await delay(1000)

    this.pageReady = true
    this.currentModel = ''
  }

  /** 等待 document.readyState === 'complete' */
  private async waitForReady(maxWaitMs: number): Promise<void> {
    const wc = this.getWebContents()
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      const ready: boolean = await wc.executeJavaScript(
        `document.readyState === 'complete' && document.body !== null`,
      )
      if (ready) return
      await delay(500)
    }
  }

  /** 等待 DOM 中出现指定元素，返回是否找到 */
  private async waitForSelector(
    selector: string,
    maxWaitMs: number = ADAPTER_TIMEOUT,
  ): Promise<boolean> {
    const wc = this.getWebContents()
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      const found: boolean = await wc.executeJavaScript(
        `(function() { return !!document.querySelector(${JSON.stringify(selector)}); })()`,
      )
      if (found) return true
      await delay(500)
    }
    return false
  }

  /** 诊断：导出 session 区域附近的 DOM 结构 */
  async diagnoseSessionArea(): Promise<string> {
    const wc = this.getWebContents()
    return wc.executeJavaScript(`
      (function() {
        var results = [];
        // 找到包含 "Select where your generations will be saved." 的元素
        var all = document.querySelectorAll('*');
        var target = null;
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || '').trim();
          if (t === 'Select where your generations will be saved.' && all[i].offsetParent !== null) {
            target = all[i];
            break;
          }
        }
        if (!target) return 'NO SESSION WARNING FOUND';

        // 向上找 4 层父元素
        var el = target;
        for (var depth = 0; depth < 4 && el; depth++) {
          var info = {
            depth: depth,
            tag: el.tagName,
            id: el.id || '',
            className: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
            role: el.getAttribute('role') || '',
            dataTestid: el.getAttribute('data-testid') || '',
            text: (el.textContent || '').trim().slice(0, 200),
            childCount: el.children.length,
            computedDisplay: window.getComputedStyle(el).display,
          };
          // 列出直属子元素
          var children = [];
          for (var c = 0; c < Math.min(el.children.length, 20); c++) {
            var child = el.children[c];
            children.push({
              tag: child.tagName,
              text: (child.textContent || '').trim().slice(0, 60),
              className: (typeof child.className === 'string' ? child.className : '').slice(0, 60),
              role: child.getAttribute('role') || '',
              clickable: child.onclick !== null || child.tagName === 'BUTTON' || child.tagName === 'A' || child.getAttribute('role') === 'button',
            });
          }
          info.children = children;
          results.push(info);
          el = el.parentElement;
        }

        // 额外：列出页面所有按钮及其文本
        var btns = [];
        var allBtns = document.querySelectorAll('button, [role="button"], a');
        for (var b = 0; b < allBtns.length; b++) {
          var btn = allBtns[b];
          if (btn.offsetParent !== null) {
            btns.push({
              tag: btn.tagName,
              text: (btn.textContent || '').trim().slice(0, 60),
              className: (typeof btn.className === 'string' ? btn.className : '').slice(0, 60),
            });
          }
        }
        results.push({ allVisibleButtons: btns });

        return JSON.stringify(results, null, 2);
      })()
    `)
  }

  /** 诊断：导出页面中所有可交互元素，用于调试选择器 */
  async diagnosePage(): Promise<string> {
    const wc = this.getWebContents()
    const result: string = await wc.executeJavaScript(`
      (function() {
        const elements = [];
        function add(el, extra) {
          elements.push({
            tag: el.tagName,
            text: (el.textContent || '').trim().slice(0, 80),
            id: el.id || '',
            className: (typeof el.className === 'string') ? el.className.slice(0, 80) : '',
            ariaLabel: el.getAttribute('aria-label') || '',
            dataTestid: el.getAttribute('data-testid') || '',
            placeholder: el.getAttribute('placeholder') || '',
            role: el.getAttribute('role') || '',
            visible: el.offsetParent !== null,
            ...extra,
          });
        }
        // 所有按钮
        document.querySelectorAll('button, [role="button"]').forEach(el => add(el));
        // 所有输入框（包括不可见的）
        document.querySelectorAll('textarea, input, [contenteditable="true"]').forEach(el => add(el, { value: (el.value || '').slice(0, 40) }));
        // 所有 role=option 的元素
        document.querySelectorAll('[role="option"], [role="menuitem"]').forEach(el => add(el));
        return JSON.stringify(elements, null, 2);
      })()
    `)
    return result
  }

  async selectModel(modelId: string): Promise<void> {
    await this.withRetry(async () => {
      const wc = this.getWebContents()
      await withTimeout(
        (async () => {
          // 1. 点击模型下拉按钮
          const dropdownSelector = RUNWAY_SELECTORS.modelDropdown
          const found = await this.waitForSelector(dropdownSelector)
          if (!found) throw new Error(`Model dropdown not found: ${dropdownSelector}`)

          await wc.executeJavaScript(
            `document.querySelector(${JSON.stringify(dropdownSelector)}).click()`,
          )

          // 2. 等待下拉展开
          await delay(1000)

          // 3. 诊断：导出下拉菜单中所有可见文本
          const dropdownOptions: string = await wc.executeJavaScript(
            `(function() {
              const items = [];
              // 无差别抓取所有可见叶子元素
              document.querySelectorAll('*').forEach(el => {
                if (el.offsetParent !== null && el.children.length === 0) {
                  const t = (el.textContent || '').trim();
                  if (t.length > 0 && t.length < 120) {
                    items.push(t);
                  }
                }
              });
              return JSON.stringify([...new Set(items)]);
            })()`,
          )
          console.log('[Adapter] All visible texts on page:', dropdownOptions)

          // 4. 通过显示名称匹配模型选项并点击
          const displayName = MODEL_CAPS[modelId]?.name || modelId
          const clicked: boolean = await wc.executeJavaScript(
            clickOptionByTextJS(displayName),
          )
          if (!clicked) {
            // 如果没找到，尝试用 modelId 匹配
            const retryClicked: boolean = await wc.executeJavaScript(
              clickOptionByTextJS(modelId),
            )
            if (!retryClicked) {
              throw new Error(
                `Model option not found: ${displayName}. Dropdown options: ${dropdownOptions}`,
              )
            }
          }

          await delay(500)
        })(),
        ADAPTER_TIMEOUT,
        `selectModel(${modelId})`,
      )
    }, `selectModel(${modelId})`)
  }

  async fillPrompt(prompt: string): Promise<void> {
    await this.withRetry(async () => {
      const wc = this.getWebContents()

      await withTimeout(
        (async () => {
          const promptSelector = RUNWAY_SELECTORS.promptInput
          const diag: {
            found: boolean
            tag?: string
            visible?: boolean
            afterFillLen?: number
            selIdx?: number
            drilled?: boolean
          } = await wc.executeJavaScript(
            `(function() {
              var selList = ${JSON.stringify(promptSelector.split(/,\s*/))};
              var text = ${JSON.stringify(prompt)};

              // ── 第 1 步：查找元素 ──
              var el = null;
              var selIdx = -1;
              for (var i = 0; i < selList.length; i++) {
                var cand = document.querySelector(selList[i]);
                if (cand) {
                  el = cand;
                  selIdx = i;
                  break;
                }
              }
              if (!el) return { found: false };

              var tag = el.tagName;
              var isInput = tag === 'TEXTAREA' || tag === 'INPUT';

              // ── 钻取：如果不是 INPUT/TEXTAREA 且自身没有 contenteditable 属性 → 深入子节点找真正的 textbox ──
              var drilled = false;
              if (!isInput && el.getAttribute('contenteditable') !== 'true') {
                var child = el.querySelector('[contenteditable="true"]');
                if (child) {
                  el = child;
                  tag = el.tagName;
                  isInput = tag === 'TEXTAREA' || tag === 'INPUT';
                  drilled = true;
                }
              }

              var visible = el.offsetParent !== null;
              if (!visible) return { found: true, tag: tag, visible: false, selIdx: selIdx, drilled: drilled };

              el.focus();
              el.click();

              // ── 第 2 步：清空 ──
              if (isInput) {
                el.select();
                var ns = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                  || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                if (ns && ns.set) { ns.set.call(el, ''); }
                else { el.value = ''; }
              } else {
                // contenteditable: 全选后删除内容
                var sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                  var range = document.createRange();
                  range.selectNodeContents(el);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
              }

              // ── 第 3 步：填充（使用 execCommand insertText，React 受控组件兼容） ──
              if (isInput) {
                var ns2 = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                  || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                if (ns2 && ns2.set) { ns2.set.call(el, text); }
                else { el.value = text; }
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                document.execCommand('insertText', false, text);
              }

              // ── 第 4 步：触发 React 事件 ──
              el.dispatchEvent(new Event('change', { bubbles: true }));

              var afterFillLen = (el.textContent || el.innerText || el.value || '').length;
              return { found: true, tag: tag, visible: true, afterFillLen: afterFillLen, selIdx: selIdx, drilled: drilled };
            })()`,
          )

          console.log('[Adapter] fillPrompt diag:', JSON.stringify(diag))

          if (!diag.found) {
            throw new Error('fillPrompt: prompt element not found in DOM')
          }
          if (!diag.visible) {
            throw new Error(`fillPrompt: element <${diag.tag}> found but not visible (offsetParent=null)`)
          }
          if ((diag.afterFillLen ?? 0) <= 10) {
            throw new Error(
              `fillPrompt: text write failed — afterFill:${diag.afterFillLen} tag:<${diag.tag}> drilled:${diag.drilled}`,
            )
          }
        })(),
        ADAPTER_TIMEOUT,
        'fillPrompt',
      )
    }, 'fillPrompt')
  }

  /** 关闭页面上所有阻塞弹窗/对话框/提示（仅处理模态容器内的元素） */
  private async dismissDialogs(): Promise<number> {
    const wc = this.getWebContents()
    const dismissed: number = await wc.executeJavaScript(`
      (function() {
        var count = 0;

        // 找到所有可能的模态/对话框容器
        var containers = document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], ' +
          '[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], ' +
          '[class*="overlay"], [class*="Overlay"], [class*="backdrop"], [class*="Backdrop"], ' +
          '[class*="popup"], [class*="Popup"], [class*="popover"], [class*="Popover"], ' +
          '[class*="drawer"], [class*="Drawer"], [class*="toast"], [class*="Toast"]'
        );
        
        // 如果没有找到任何模态容器，直接返回 0（不误杀主界面按钮）
        if (containers.length === 0) return 0;

        for (var c = 0; c < containers.length; c++) {
          var container = containers[c];
          if (container.offsetParent === null) continue;

          // 1. 在容器内查找关闭按钮（× / Close / Dismiss）
          var closeBtns = container.querySelectorAll(
            '[aria-label="Close"], [aria-label="close"], [data-testid="close"], ' +
            'button[class*="close"], button[class*="Close"], button[class*="Dismiss"]'
          );
          for (var i = 0; i < closeBtns.length; i++) {
            if (closeBtns[i].offsetParent !== null) {
              closeBtns[i].click();
              count++;
            }
          }

          // 2. 在容器内查找确认类按钮
          var confirmTexts = ['Got it', 'Continue', 'OK', 'Accept', 'Agree', 'Dismiss', 'Confirm', 'Next', 'Skip', 'Maybe later', 'Not now'];
          var btns = container.querySelectorAll('button, [role="button"]');
          for (var j = 0; j < btns.length; j++) {
            var txt = (btns[j].textContent || '').trim();
            if (btns[j].offsetParent !== null && confirmTexts.indexOf(txt) >= 0) {
              btns[j].click();
              count++;
            }
          }
        }

        return count;
      })()
    `)

    if (dismissed > 0) {
      console.log(`[Adapter] Dismissed ${dismissed} blocking UI elements`)
      // 等待弹窗关闭动画
      await delay(1000)
    }
    return dismissed
  }

  async clickGenerate(): Promise<void> {
    const wc = this.getWebContents()
    console.log('[Adapter] clickGenerate: START')

    // 等待页面在 fillPrompt 之后 settle（React 状态更新可能需要时间）
    await delay(500)

      // 诊断：打印页面可见文本（仅在 debug 模式下执行）
      let visibleTexts = ''
      if (ADAPTER_DEBUG) {
        visibleTexts = await wc.executeJavaScript(`
          (function() {
            var texts = [];
            document.querySelectorAll('*').forEach(function(el) {
              if (el.offsetParent !== null && el.children.length === 0) {
                var t = (el.textContent || '').trim();
                if (t.length > 2 && t.length < 100) texts.push(t);
              }
            });
            return JSON.stringify([...new Set(texts)].slice(0, 50));
          })()
        `)
        console.log('[Adapter] Page visible texts before click:', visibleTexts)
      }

      // ── 1. 配置 session/folder（Runway 要求先选保存位置才能生成）──
      const needSessionSetup: boolean = await wc.executeJavaScript(`
        (function() {
          return (document.body.innerText || '').indexOf('Select where your generations will be saved.') !== -1;
        })()
      `)
      console.log('[Adapter] clickGenerate: needSessionSetup =', needSessionSetup)

      if (needSessionSetup) {
        if (ADAPTER_DEBUG) {
          console.log('[Adapter] Session setup required — diagnosing session area...')
          const sessionDiag = await this.diagnoseSessionArea()
          console.log('[Adapter] Session area DOM:', sessionDiag)
        }

        let sessionOk = false

        // 流程: folderContainer → popover中找 "Change folder" → 文件夹选择器 → 选文件夹 → Select
        console.log('[Adapter] Configuring session folder...')

        // 步骤 A: 点击 folderContainer 打开弹出层
        const containerClicked: boolean = await wc.executeJavaScript(`
          (function() {
            var el = document.querySelector('.folderContainer-aV_LJB');
            if (!el || el.offsetParent === null) {
              var btns = document.querySelectorAll('[role="button"]');
              for (var i = 0; i < btns.length; i++) {
                var t = (btns[i].textContent || '').trim();
                if (t.indexOf('Sessions') > -1 && t.indexOf('Change folder') > -1 && btns[i].offsetParent !== null) {
                  el = btns[i];
                  break;
                }
              }
            }
            if (!el) return false;
            el.click();
            return true;
          })()
        `)
        console.log('[Adapter] folderContainer click:', containerClicked)

        if (containerClicked) {
          await delay(2000)

          // 步骤 B: 在弹出层中找 "Change folder" 并点击（仅在 popover 内搜索，不触动主页面的）
          const cfClicked: boolean = await wc.executeJavaScript(`
            (function() {
              var popovers = document.querySelectorAll(
                '[role="menu"], [role="listbox"], [role="dialog"], ' +
                '[class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"], ' +
                '[class*="menu"], [class*="Menu"], [class*="panel"], [class*="Panel"]'
              );
              for (var c = 0; c < popovers.length; c++) {
                if (popovers[c].offsetParent === null) continue;
                // 在 popover 内部找包含 "Change folder" 文本的元素
                var all = popovers[c].querySelectorAll('*');
                for (var i = 0; i < all.length; i++) {
                  if (all[i].offsetParent === null) continue;
                  var t = (all[i].textContent || '').trim();
                  if (t === 'Change folder') {
                    all[i].click();
                    return true;
                  }
                }
              }
              return false;
            })()
          `)
          console.log('[Adapter] Change folder in popover click:', cfClicked)

          if (cfClicked) {
            await delay(2000)

            if (ADAPTER_DEBUG) {
              const afterCfTexts: string = await wc.executeJavaScript(`
                (function() {
                  var texts = [];
                  document.querySelectorAll('*').forEach(function(el) {
                    if (el.offsetParent !== null && el.children.length === 0) {
                      var t = (el.textContent || '').trim();
                      if (t.length > 0 && t.length < 100) texts.push(t);
                    }
                  });
                  return JSON.stringify([...new Set(texts)].slice(0, 80));
                })()
              `)
              console.log('[Adapter] Texts after Change folder click:', afterCfTexts)

              const afterCfElements: string = await wc.executeJavaScript(`
                (function() {
                  var items = [];
                  document.querySelectorAll('*').forEach(function(el) {
                    if (el.offsetParent === null) return;
                    var t = (el.textContent || '').trim();
                    if (t === 'Private Assets' || t === 'Shared Assets' || t === 'Select' || t === 'Cancel') {
                      items.push({
                        tag: el.tagName,
                        text: t,
                        className: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
                        role: el.getAttribute('role') || '',
                        parentTag: el.parentElement ? el.parentElement.tagName : '',
                        parentClass: el.parentElement ? (typeof el.parentElement.className === 'string' ? el.parentElement.className.slice(0, 60) : '') : '',
                        parentRole: el.parentElement ? (el.parentElement.getAttribute('role') || '') : '',
                      });
                    }
                  });
                  return JSON.stringify(items, null, 2);
                })()
              `)
              console.log('[Adapter] Folder-related elements after CF click:', afterCfElements)
            }

            // 步骤 C: 用 sendInputEvent (真实 OS 鼠标事件) 选择 "Private Assets" 文件夹
            // JS dispatchEvent 无法触发 Runway 的 React 组件选中状态
            const folderCoords: string = await wc.executeJavaScript(`
              (function() {
                var all = document.querySelectorAll('*');
                for (var i = 0; i < all.length; i++) {
                  var el = all[i];
                  if (el.offsetParent === null) continue;
                  var cls = typeof el.className === 'string' ? el.className : '';
                  var t = (el.textContent || '').trim();
                  if (cls.indexOf('ExpandableAssetGroup') > -1 && t === 'Private Assets') {
                    var r = el.getBoundingClientRect();
                    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
                  }
                }
                return null;
              })()
            `)
            console.log('[Adapter] Folder coords:', folderCoords)

            if (folderCoords) {
              const fc = JSON.parse(folderCoords)
              const f1 = jitterPoint(fc.x, fc.y)
              const f2 = jitterPoint(fc.x, fc.y)
              wc.sendInputEvent({ type: 'mouseDown', x: f1.x, y: f1.y, button: 'left', clickCount: 1 })
              await humanClickGap()
              wc.sendInputEvent({ type: 'mouseUp', x: f2.x, y: f2.y, button: 'left', clickCount: 1 })
              await delay(500)
              console.log('[Adapter] Sent OS click to Private Assets at', fc)
            } else {
              console.log('[Adapter] Could not find Private Assets coords')
            }

            // 步骤 D: 用 sendInputEvent 点击 Select 按钮
            await delay(500)
            const selectCoords: string = await wc.executeJavaScript(`
              (function() {
                var btns = document.querySelectorAll('button, [role="button"]');
                for (var i = 0; i < btns.length; i++) {
                  var t = (btns[i].textContent || '').trim();
                  if (btns[i].offsetParent !== null && t === 'Select' && !btns[i].disabled) {
                    var r = btns[i].getBoundingClientRect();
                    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: false });
                  } else if (btns[i].offsetParent !== null && t === 'Select' && btns[i].disabled) {
                    return JSON.stringify({ x: 0, y: 0, disabled: true });
                  }
                }
                return null;
              })()
            `)
            console.log('[Adapter] Select button coords:', selectCoords)

            if (selectCoords) {
              const sc = JSON.parse(selectCoords)
              if (!sc.disabled) {
                const s1 = jitterPoint(sc.x, sc.y)
                const s2 = jitterPoint(sc.x, sc.y)
                wc.sendInputEvent({ type: 'mouseDown', x: s1.x, y: s1.y, button: 'left', clickCount: 1 })
                await humanClickGap()
                wc.sendInputEvent({ type: 'mouseUp', x: s2.x, y: s2.y, button: 'left', clickCount: 1 })
                console.log('[Adapter] Sent OS click to Select button at', sc)
                sessionOk = true
              } else {
                console.log('[Adapter] Select button is DISABLED — folder was not selected')
              }
            } else {
              console.log('[Adapter] Could not find Select button')
            }
          }
        }

        await delay(1000)
        const dismissedAll = await this.dismissDialogs()
        console.log('[Adapter] Dismissed', dismissedAll, 'dialogs after folder config')

        await delay(500)

        if (sessionOk) {
          console.log('[Adapter] Session configured successfully')
        } else {
          console.log('[Adapter] WARNING: Session not configured — will try Generate anyway')
        }
      }

      // ── 2. 清除阻塞弹窗 ──
      const preDismissed = await this.dismissDialogs()
      console.log('[Adapter] clickGenerate: pre-dismissDialogs cleared', preDismissed, 'dialogs')
      // ── 3. 查找 Generate 按钮 ──
      const btnInfo = await wc.executeJavaScript(`(function() {
        var candidates = [];
        var all = document.querySelectorAll('button, [role="button"], a[role="button"], input[type="submit"], input[type="button"]');
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || all[i].value || '').trim();
          if (/generate|create|produce/i.test(t)) {
            var r = all[i].getBoundingClientRect();
            candidates.push({
              text: t,
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
              w: Math.round(r.width),
              h: Math.round(r.height),
              disabled: !!all[i].disabled,
              visible: all[i].offsetParent !== null,
              tag: all[i].tagName,
            });
          }
        }
        return JSON.stringify(candidates);
      })()`)
      console.log('[Adapter] Generate button candidates:', btnInfo)

      let candidates: Array<{ text: string; x: number; y: number; w: number; h: number; disabled: boolean; visible: boolean; tag: string }>
      try {
        candidates = JSON.parse(btnInfo)
      } catch {
        throw new Error(`Generate button detection failed. Raw response: ${btnInfo}`)
      }

      let rect = candidates.find(c => c.text === 'Generate' && c.visible && !c.disabled)
      if (!rect) {
        rect = candidates.find(c => c.visible && !c.disabled && /^generate$/i.test(c.text))
      }
      if (!rect) {
        rect = candidates.find(c => c.visible && !c.disabled)
      }

      if (!rect) {
        throw new Error(`Generate button not found. Candidates: ${btnInfo}`)
      }

      console.log(`[Adapter] clickGenerate: Clicking Generate "${rect.text}" at (${rect.x}, ${rect.y})`)

      // 发送 OS 级鼠标点击（坐标加噪声模拟真人微动）
      const g1 = jitterPoint(rect.x, rect.y)
      const g2 = jitterPoint(rect.x, rect.y)
      console.log('[Adapter] clickGenerate: sending OS mouse events...')
      wc.sendInputEvent({ type: 'mouseDown', x: g1.x, y: g1.y, button: 'left', clickCount: 1 })
      await humanClickGap()
      wc.sendInputEvent({ type: 'mouseUp', x: g2.x, y: g2.y, button: 'left', clickCount: 1 })
      console.log('[Adapter] clickGenerate: OS mouse events sent')

      // JS MouseEvent 兜底（Runway 是 React SPA，合成事件有时需要 JS 级事件）
      await delay(200)
      await wc.executeJavaScript(`
        (function() {
          var btns = document.querySelectorAll('button, [role="button"]');
          for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || '').trim();
            if (t === 'Generate' && btns[i].offsetParent !== null && !btns[i].disabled) {
              var r = btns[i].getBoundingClientRect();
              btns[i].dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
                button: 0
              }));
              return;
            }
          }
        })()
      `)
      console.log('[Adapter] clickGenerate: JS click dispatched, dismissing post-click dialogs...')
      // 关闭点击后弹出的对话框（如有）
      await delay(1000)
      const dismissed = await this.dismissDialogs()
      if (dismissed > 0) console.log(`[Adapter] Dismissed ${dismissed} post-click dialogs`)
      console.log('[Adapter] clickGenerate: DONE')
  }

  /**
   * 检测生成状态（DOM 探测，保留用于手动诊断）
   * @deprecated 已被 waitForCompletion 中的 CDP 网络监听取代
   */
  async checkStatus(): Promise<GenerationStatus> {
    const wc = this.getWebContents()
    const status: string = await withTimeout(
      wc.executeJavaScript(
        `(function() {
          const btns = document.querySelectorAll('button, [role="button"]');
          for (const btn of btns) {
            const t = (btn.textContent || '').trim();
            if (t === 'Generate' && btn.offsetParent !== null) return 'idle';
            if (/generating|loading|progress|remaining/i.test(t) && btn.offsetParent !== null) return 'generating';
          }
          if (document.querySelector('video, img[src*="runway"], [class*="VideoPlayer"], [class*="preview"], [class*="result"]')) {
            return 'completed';
          }
          if (document.querySelector('[class*="progress"], [class*="Progress"], progress, [role="progressbar"]')) {
            return 'generating';
          }
          const errorEl = document.querySelector('[class*="error"], [class*="Error"], [class*="failed"]');
          if (errorEl && errorEl.offsetParent !== null) {
            const text = (errorEl.textContent || '').toLowerCase();
            if (/error|failed/i.test(text)) return 'failed';
          }
          return 'generating';
        })()`,
      ),
      ADAPTER_TIMEOUT,
      'checkStatus',
    )
    return status as GenerationStatus
  }

  /**
   * 等待生成完成 — CDP 网络监听，从 Runway API 响应直接获取结果
   *
   * 原理：
   *   点击 Generate 后，Runway 前端通过 fetch/SSE 轮询后端任务状态。
   *   我们通过 Chrome DevTools Protocol 监听 Network.responseReceived 事件，
   *   直接读取 Runway 后端的 JSON 响应，从中提取视频 URL 和完成状态。
   *
   * CDP 冲突处理：
   *   当多个任务共享同一 WebContents 时，只有一个能 attach debugger。
   *   如果 debugger 已被占用，等待 CDP_RETRY_DELAY 后重试，最多 3 次。
   *   超时后才回退 DOM 轮询。
   */
  async waitForCompletion(taskId?: string): Promise<GenerationResult> {
    const tid = taskId ?? 'unknown'
    // 多次尝试 CDP，处理 debugger 冲突
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.waitForNetworkResult(tid)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`[Adapter] CDP attempt ${attempt + 1}/3 failed for ${tid}: ${msg}`)
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, CDP_RETRY_DELAY))
        }
      }
    }
    // CDP 不可用，回退到 DOM 轮询
    console.log(`[Adapter] Falling back to DOM polling for ${tid}`)
    return this.waitForDomResult()
  }

  /** CDP 网络监听：拦截 Runway API 响应 */
  private async waitForNetworkResult(taskId: string): Promise<GenerationResult> {
    const wc = this.getWebContents()
    const dbg = wc.debugger

    let wasAttached = false
    try {
      if (dbg.isAttached()) {
        wasAttached = true
        // 如果 DevTools 占用 debugger，直接抛异常回退 DOM 方案
        throw new Error('Debugger already attached by DevTools')
      }
      dbg.attach('1.3')
      await dbg.sendCommand('Network.enable')
    } catch {
      throw new Error('CDP unavailable')
    }

    return new Promise<GenerationResult>((resolve) => {
      const start = Date.now()

      // 超时保护
      const timeout = setTimeout(() => {
        cleanup()
        resolve({ status: 'failed', error: `Network detection timeout after ${MAX_WAIT_TIME}ms` })
      }, MAX_WAIT_TIME)

      // 兜底：每 10 秒检查 DOM，防止网络监听漏检
      const domFallback = setInterval(async () => {
        try {
          const domStatus = await this.checkStatus()
          if (domStatus === 'completed') {
            clearTimeout(timeout)
            clearInterval(domFallback)
            cleanup()
            const url = await this.extractVideoUrl()
            resolve({ status: 'completed', videoUrl: url || undefined })
          } else if (domStatus === 'failed') {
            clearTimeout(timeout)
            clearInterval(domFallback)
            cleanup()
            resolve({ status: 'failed', error: 'DOM check reported failure' })
          }
        } catch { /* 继续等 */ }
      }, 10_000)

      let resolved = false

      const messageHandler = async (
        _event: Electron.Event,
        method: string,
        params: Record<string, unknown>,
      ) => {
        if (method !== 'Network.responseReceived' || resolved) return

        const response = (params.response as Record<string, unknown>) || {}
        const url: string = (response.url as string) || ''
        const mimeType: string = (response.mimeType as string) || ''
        const status: number = (response.status as number) || 0

        // ── 信号 1：视频文件直接加载（最可靠） ──
        if (mimeType.startsWith('video/') || /\.(mp4|webm|mov)(\?|$)/i.test(url)) {
          console.log(`[Adapter] CDP detected video asset for ${taskId}:`, url)
          resolved = true
          clearTimeout(timeout)
          clearInterval(domFallback)
          cleanup()
          resolve({ status: 'completed', videoUrl: url })
          return
        }

        // ── 信号 2：Runway 生成任务 API 响应 ──
        if (status === 200 && /generation|task|asset|output|job/i.test(url)) {
          try {
            const { body, base64Encoded } = await dbg.sendCommand(
              'Network.getResponseBody',
              { requestId: params.requestId as string },
            ) as { body: string; base64Encoded: boolean }

            const text = base64Encoded
              ? Buffer.from(body, 'base64').toString('utf-8')
              : body

            let data: Record<string, unknown>
            try {
              data = JSON.parse(text)
            } catch {
              // 不是 JSON（可能是 SSE 流），忽略
              return
            }

            const taskStatus = (data.status || data.state || '') as string

            if (/succeeded|completed|done|ready/i.test(taskStatus)) {
              const videoUrl = (data.video_url || data.url || data.output_url ||
                data.asset_url || data.result?.url || '') as string
              console.log(`[Adapter] CDP detected API completion for ${taskId}:`, taskStatus, videoUrl)
              resolved = true
              clearTimeout(timeout)
              clearInterval(domFallback)
              cleanup()
              resolve({ status: 'completed', videoUrl: videoUrl || undefined })
            } else if (/failed|error|cancelled/i.test(taskStatus)) {
              console.log(`[Adapter] CDP detected API failure for ${taskId}:`, taskStatus)
              resolved = true
              clearTimeout(timeout)
              clearInterval(domFallback)
              cleanup()
              resolve({
                status: 'failed',
                error: (data.error || data.message || taskStatus) as string,
              })
            }
          } catch {
            // getResponseBody 可能失败（流式响应），忽略继续等下一个请求
          }
        }

        // 超时检查
        if (Date.now() - start >= MAX_WAIT_TIME) {
          resolved = true
          clearTimeout(timeout)
          clearInterval(domFallback)
          cleanup()
          resolve({ status: 'failed', error: `Timeout after ${MAX_WAIT_TIME}ms` })
        }
      }

      dbg.on('message', messageHandler)

      function cleanup() {
        dbg.removeListener('message', messageHandler)
        if (!wasAttached) {
          try { dbg.detach() } catch { /* already detached */ }
        }
      }
    })
  }

  /** 从 DOM 提取视频 URL */
  private async extractVideoUrl(): Promise<string> {
    const wc = this.getWebContents()
    return wc.executeJavaScript(
      `(function() {
        const el = document.querySelector('video source, video[src]');
        return el ? (el.getAttribute('src') || '') : '';
      })()`,
    )
  }

  /** DOM 轮询方案（CDP 不可用时的回退） */
  private async waitForDomResult(): Promise<GenerationResult> {
    const start = Date.now()
    let consecutiveErrors = 0

    while (Date.now() - start < MAX_WAIT_TIME) {
      try {
        const status = await this.checkStatus()
        consecutiveErrors = 0

        if (status === 'completed') {
          const url = await this.extractVideoUrl()
          return { status: 'completed', videoUrl: url || undefined }
        }

        if (status === 'failed') {
          return { status: 'failed', error: 'Runway reported generation failed' }
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      } catch (err) {
        consecutiveErrors++
        if (consecutiveErrors >= 3) {
          return {
            status: 'failed',
            error: `Repeated check failures: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
      }
    }

    return { status: 'failed', error: `Timeout after ${MAX_WAIT_TIME}ms waiting for completion` }
  }
}

export const runwayAdapter = new RunwayAdapter()
