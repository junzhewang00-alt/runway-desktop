import type { BrowserView } from 'electron'
import { clipboard } from 'electron'
import {
  RUNWAY_SELECTORS,
  ADAPTER_TIMEOUT,
  POLL_INTERVAL,
  MAX_WAIT_TIME,
  clickButtonByTextJS,
  clickOptionByTextJS,
} from './runway.selectors'

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
  uploadReferenceImages(imagePaths: string[]): Promise<void>
  /** 并发提交：仅提交不等待，完成后由 CDP monitor 回调 */
  submitOnly(taskId: string, modelId: string, prompt: string, imagePaths?: string[]): Promise<void>
  /** 启动持久 CDP 网络监听（应用启动时调用一次） */
  startPersistentMonitor(): Promise<void>
  stopPersistentMonitor(): void
  /** Runway 槽位查询 */
  getAvailableSlots(): number
  hasSlot(): boolean
  /** 注册完成回调和槽位释放回调 */
  setCompletionCallback(cb: (taskId: string, result: GenerationResult) => void): void
  setSlotFreedCallback(cb: () => void): void
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

/** 设为 true 输出 DOM 诊断日志（调试 Runway 页面结构时启用） */
const ADAPTER_DEBUG = false

/** 模型 ID 到 Runway 页面显示名称的映射 */
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'wan-2.6': 'WAN 2.6',
  'gen-4': 'Gen-4',
  'gen-4.5': 'Gen-4.5',
  aleph: 'Aleph',
  'seedance-2': 'Seedance 2.0',
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

  setBrowserView(bv: BrowserView): void {
    this.browserView = bv
    this.pageReady = false
    // 如果 monitor 之前启动了，用新 WebContents 重启
    if (this.monitorActive) {
      this.stopPersistentMonitor()
      this.startPersistentMonitor().catch((err) => {
        console.log('[Adapter] Failed to restart monitor after BrowserView swap:', err)
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

  setCompletionCallback(cb: (taskId: string, result: GenerationResult) => void): void {
    this.onComplete = cb
  }

  setSlotFreedCallback(cb: () => void): void {
    this.onSlotFreed = cb
  }

  // ── 并发提交：仅提交不等待 ──

  /**
   * 提交任务到 Runway 并立即返回。
   * 持锁时间仅 10-20s（页面交互），不等待视频生成完成。
   * 生成完成后由持久 CDP monitor 通过 setCompletionCallback 回调通知。
   */
  /**
   * 将参考图上传到 Runway 页面的首帧图/参考图区域
   *
   * 策略：查找 Runway 页面上的隐藏 <input type="file"> 或上传区域，
   * 通过构造 File 对象 + DataTransfer 模拟用户拖拽上传。
   */
  async uploadReferenceImages(imagePaths: string[]): Promise<void> {
    if (imagePaths.length === 0) return

    const wc = this.getWebContents()

    for (let i = 0; i < imagePaths.length; i++) {
      const filePath = imagePaths[i]
      console.log(`[Adapter] Uploading reference image ${i + 1}/${imagePaths.length}: ${filePath}`)

      const uploaded: boolean = await wc.executeJavaScript(`
        (function() {
          // 策略 A: 查找拖放区域
          var dropTargets = document.querySelectorAll(
            '[class*="FirstFrame"], [class*="first-frame"], ' +
            '[class*="upload-area"], [class*="Upload"], ' +
            '[class*="dropzone"], [class*="DropZone"]'
          );

          if (dropTargets.length === 0) {
            // 查找包含 "First Video Frame" 文本的父元素
            var all = document.querySelectorAll('*');
            for (var k = 0; k < all.length; k++) {
              var txt = (all[k].textContent || '').trim();
              if (txt === 'First Video Frame' && all[k].offsetParent !== null) {
                var closest = all[k].closest('div, section, [class*="upload"]');
                dropTargets = [closest || all[k]];
                break;
              }
            }
          }

          if (dropTargets.length === 0) return false;

          // 构造 DataTransfer 模拟拖拽
          var dt = new DataTransfer();
          var fileName = ${JSON.stringify(filePath.split(/[/\\\\]/).pop() || 'image.png')};
          try {
            dt.items.add(new File([''], fileName, { type: 'image/png' }));
          } catch(e) {
            return false;
          }

          ;['dragenter', 'dragover', 'drop'].forEach(function(type) {
            var ev = new DragEvent(type, {
              bubbles: true, cancelable: true,
              dataTransfer: dt,
            });
            dropTargets[0].dispatchEvent(ev);
          });

          return true;
        })()
      `)

      if (!uploaded) {
        console.warn(`[Adapter] Cannot upload image ${filePath} — Runway upload area not found in DOM`)
      }

      // 等待上传完成
      await new Promise((r) => setTimeout(r, 1000))
    }

    console.log(`[Adapter] Reference image upload complete: ${imagePaths.length} images`)
  }

  async submitOnly(taskId: string, modelId: string, prompt: string, imagePaths?: string[]): Promise<void> {
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
    console.log(`[Adapter] Task ${taskId.slice(0, 8)} assigned slot ${assignedSlot} — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`)

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

        // 3. 上传参考图（如有）
        if (imagePaths && imagePaths.length > 0) {
          await this.uploadReferenceImages(imagePaths)
        }

        // 4. 填充提示词
        await this.fillPrompt(prompt)

        // 5. 点击生成（内部含 session 配置逻辑）
        await this.clickGenerate()

        // 重置页面状态，下一个任务会在 resetPage 中 reload 页面
        // Runway 的生成是服务端的，reload 不会取消已提交的生成
        this.pageReady = false
        this.currentModel = ''

        // 记录提交到 CDP monitor 的匹配队列
        this.submittedTasks.set(taskId, { slot: assignedSlot, submittedAt: Date.now() })
        console.log(`[Adapter] Task ${taskId.slice(0, 8)} submitted on slot ${assignedSlot} — Runway slots: ${this.runwaySlots}/${this.MAX_SLOTS}`)
      } finally {
        this.releaseLockForTask(taskId)
      }
    } catch (err) {
      // 提交失败，释放槽位
      this.slotOccupied[assignedSlot] = false
      this.runwaySlots = Math.max(0, this.runwaySlots - 1)
      console.log(`[Adapter] Task ${taskId.slice(0, 8)} submission failed, slot ${assignedSlot} released — slots: ${this.runwaySlots}/${this.MAX_SLOTS}`)
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
    if (this.monitorStarting) {
      console.log('[Adapter.Monitor] Startup already in progress, waiting...')
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

    if (dbg.isAttached()) {
      console.log('[Adapter.Monitor] Debugger already attached (possibly DevTools), will retry later')
      this.reattachMonitor()
      return
    }

    try {
      dbg.attach('1.3')
      await dbg.sendCommand('Network.enable')
      this.monitorActive = true
      this.monitorReconnectAttempts = 0
      console.log('[Adapter.Monitor] Persistent CDP monitor started')

      // 监听 debugger detach（如 DevTools 打开），尝试自动重连
      dbg.on('detach', this.onDetach)
      // 持久消息处理器
      dbg.on('message', this.persistentMessageHandler)
    } catch (err) {
      console.log('[Adapter.Monitor] Failed to start CDP monitor:', err)
      this.monitorActive = false
      this.reattachMonitor()
    }
  }

  private onDetach = (_event: Electron.Event, reason: string): void => {
    console.log(`[Adapter.Monitor] CDP detached: ${reason}`)
    this.monitorActive = false
    this.reattachMonitor()
  }

  private monitorReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private monitorReconnectAttempts = 0
  private readonly MONITOR_MAX_RECONNECT_ATTEMPTS = 10

  private reattachMonitor(): void {
    if (this.monitorReconnectTimer) return
    if (this.monitorReconnectAttempts >= this.MONITOR_MAX_RECONNECT_ATTEMPTS) {
      console.log(`[Adapter.Monitor] Giving up reconnection after ${this.monitorReconnectAttempts} attempts`)
      return
    }
    this.monitorReconnectAttempts++
    const delay = Math.min(5000 * Math.pow(2, this.monitorReconnectAttempts - 1), 60000)
    console.log(`[Adapter.Monitor] Reconnect attempt ${this.monitorReconnectAttempts}/${this.MONITOR_MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`)
    this.monitorReconnectTimer = setTimeout(async () => {
      this.monitorReconnectTimer = null
      try {
        await this.startPersistentMonitor()
        if (this.monitorActive) {
          this.monitorReconnectAttempts = 0
          console.log('[Adapter.Monitor] Reconnected')
        }
      } catch {
        this.reattachMonitor()
      }
    }, delay)
  }

  stopPersistentMonitor(): void {
    this.monitorActive = false
    this.monitorStarting = null
    if (this.monitorReconnectTimer) {
      clearTimeout(this.monitorReconnectTimer)
      this.monitorReconnectTimer = null
    }
    try {
      const wc = this.getWebContents()
      wc.debugger.removeListener('detach', this.onDetach)
      wc.debugger.removeListener('message', this.persistentMessageHandler)
      if (wc.debugger.isAttached()) {
        wc.debugger.detach()
      }
      console.log('[Adapter.Monitor] Stopped')
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
      console.log('[Adapter.Monitor] Video asset detected:', url)
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
    console.log(`[Adapter.Monitor] Task ${taskId.slice(0, 8)} completed on slot ${entry.slot} — slots: ${this.runwaySlots}/${this.MAX_SLOTS}`)

    if (this.onComplete) {
      this.onComplete(taskId, { status: 'completed', videoUrl })
    }
    if (this.onSlotFreed) {
      this.onSlotFreed()
    }
  }

  private async handleMonitorFailure(errorMsg: unknown): Promise<void> {
    if (this.submittedTasks.size === 0) return
    const now = Date.now()
    if (now - this.lastCompletionTime < this.COMPLETION_COOLDOWN_MS) {
      console.log('[Adapter.Monitor] Skipping duplicate failure event (within cooldown)')
      return
    }
    this.lastCompletionTime = now

    const taskId = await this.matchCompletionToTask()
    if (!taskId) return

    const entry = this.submittedTasks.get(taskId)!
    this.submittedTasks.delete(taskId)
    this.slotOccupied[entry.slot] = false
    this.runwaySlots = Math.max(0, this.runwaySlots - 1)
    console.log(`[Adapter.Monitor] Task ${taskId.slice(0, 8)} failed on slot ${entry.slot} — slots: ${this.runwaySlots}/${this.MAX_SLOTS}`)

    if (this.onComplete) {
      this.onComplete(taskId, { status: 'failed', error: String(errorMsg) })
    }
    if (this.onSlotFreed) {
      this.onSlotFreed()
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
        await new Promise((r) => setTimeout(r, 1000))
      } catch {
        await new Promise((r) => setTimeout(r, 500))
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
        await wc.loadURL(
          'https://app.runwayml.com/video-tools/teams/junzhewang00/ai-tools/generate?mode=tools&tool=video',
        )
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

    await new Promise((r) => setTimeout(r, 1000))

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
      await new Promise((r) => setTimeout(r, 500))
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
      await new Promise((r) => setTimeout(r, 500))
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
          await new Promise((r) => setTimeout(r, 1000))

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
          const displayName = MODEL_DISPLAY_NAMES[modelId] || modelId
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

          await new Promise((r) => setTimeout(r, 500))
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
          // 找到 prompt 输入框，直接设置 textContent + 触发 React 事件
          const success: boolean = await wc.executeJavaScript(
            `(function() {
              // 优先匹配提示词输入框
              var selectors = [
                'textarea[placeholder*="Describe"]',
                'textarea[placeholder*="describe"]',
                'input[type="text"]',
                'textarea',
                '[contenteditable="true"]',
              ];
              var el = null;
              for (var i = 0; i < selectors.length; i++) {
                el = document.querySelector(selectors[i]);
                if (el && el.offsetParent !== null) break;
                el = null;
              }

              if (!el) return false;

              // 获取元素类型
              var isContentEditable = el.getAttribute('contenteditable') === 'true' || el.isContentEditable;
              var tagName = el.tagName;

              el.focus();
              el.click();

              // ── 清除旧文本 ──
              if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
                // 原生 input/textarea：使用原生 value setter 触发 React Fiber
                var nativeSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                ) || Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                );
                if (nativeSetter && nativeSetter.set) {
                  nativeSetter.set.call(el, '');
                } else {
                  el.value = '';
                }
              } else {
                // contenteditable div：直接清空 textContent
                el.textContent = '';
                el.innerHTML = '';
              }

              // ── 填充新文本 ──
              if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
                var nativeSetter2 = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                ) || Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'value'
                );
                if (nativeSetter2 && nativeSetter2.set) {
                  nativeSetter2.set.call(el, ${JSON.stringify(prompt)});
                } else {
                  el.value = ${JSON.stringify(prompt)};
                }
              } else {
                // contenteditable div
                el.textContent = ${JSON.stringify(prompt)};
              }

              // ── 触发 React 事件链 ──
              el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              // React 16/17 需要 compositionend
              el.dispatchEvent(new CompositionEvent('compositionend', {
                data: ${JSON.stringify(prompt)}, bubbles: true
              }));

              // 验证
              var currentText = el.textContent || el.innerText || el.value || '';
              var expected = ${JSON.stringify(prompt)};
              return currentText.trim() === expected.trim();
            })()`,
          )

          if (!success) {
            // 回退方案1：剪贴板粘贴到 contenteditable
            const fallbackOk: boolean = await wc.executeJavaScript(
              `(function() {
                var el = document.querySelector('[contenteditable="true"]');
                if (!el || el.offsetParent === null) return false;
                el.focus();
                el.textContent = '';
                el.innerHTML = '';
                document.execCommand('insertText', false, ${JSON.stringify(prompt)});
                el.dispatchEvent(new Event('input', { bubbles: true }));
                var t = el.textContent || el.innerText || '';
                return t.trim() === ${JSON.stringify(prompt)}.trim();
              })()`,
            )
            if (!fallbackOk) {
              // 回退方案2：广泛搜索任意可编辑元素
              const wideOk: boolean = await wc.executeJavaScript(
                `(function() {
                  var els = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
                  for (var i = 0; i < els.length; i++) {
                    if (els[i].offsetParent === null) continue;
                    var el = els[i];
                    el.focus();
                    el.click();
                    try {
                      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        var ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value') ||
                                 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                        if (ns && ns.set) { ns.set.call(el, ''); ns.set.call(el, ${JSON.stringify(prompt)}); }
                        else { el.value = ''; el.value = ${JSON.stringify(prompt)}; }
                      } else {
                        el.textContent = '';
                        el.innerHTML = '';
                        el.textContent = ${JSON.stringify(prompt)};
                      }
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      var t = el.textContent || el.innerText || el.value || '';
                      if (t.trim() === ${JSON.stringify(prompt)}.trim()) return true;
                    } catch(e) { continue; }
                  }
                  return false;
                })()`,
              )
              if (!wideOk) {
                throw new Error('fillPrompt: all approaches failed')
              }
            }
          }

          // 等 React 处理完状态更新
          await new Promise((r) => setTimeout(r, 800))
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
      await new Promise((r) => setTimeout(r, 1000))
    }
    return dismissed
  }

  async clickGenerate(): Promise<void> {
    const wc = this.getWebContents()

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
        // ADD DIAGNOSTIC
        (function() {
          var all = document.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            var t = (all[i].textContent || '').trim();
            if (t === 'Select where your generations will be saved.' && all[i].offsetParent !== null) {
              return true;
            }
          }
          return false;
        })()
      `)

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
          await new Promise((r) => setTimeout(r, 2000))

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
            await new Promise((r) => setTimeout(r, 2000))

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
              wc.sendInputEvent({ type: 'mouseDown', x: fc.x, y: fc.y, button: 'left', clickCount: 1 })
              await new Promise((r) => setTimeout(r, 80))
              wc.sendInputEvent({ type: 'mouseUp', x: fc.x, y: fc.y, button: 'left', clickCount: 1 })
              await new Promise((r) => setTimeout(r, 500))
              console.log('[Adapter] Sent OS click to Private Assets at', fc)
            } else {
              console.log('[Adapter] Could not find Private Assets coords')
            }

            // 步骤 D: 用 sendInputEvent 点击 Select 按钮
            await new Promise((r) => setTimeout(r, 500))
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
                wc.sendInputEvent({ type: 'mouseDown', x: sc.x, y: sc.y, button: 'left', clickCount: 1 })
                await new Promise((r) => setTimeout(r, 80))
                wc.sendInputEvent({ type: 'mouseUp', x: sc.x, y: sc.y, button: 'left', clickCount: 1 })
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

        await new Promise((r) => setTimeout(r, 1000))
        const dismissedAll = await this.dismissDialogs()
        console.log('[Adapter] Dismissed', dismissedAll, 'dialogs after folder config')

        await new Promise((r) => setTimeout(r, 500))

        if (sessionOk) {
          console.log('[Adapter] Session configured successfully')
        } else {
          console.log('[Adapter] WARNING: Session not configured — will try Generate anyway')
        }
      }

      // ── 2. 清除阻塞弹窗 ──
      await this.dismissDialogs()
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

      const candidates: Array<{ text: string; x: number; y: number; w: number; h: number; disabled: boolean; visible: boolean; tag: string }> = JSON.parse(btnInfo)

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

      console.log(`[Adapter] Clicking Generate "${rect.text}" at (${rect.x}, ${rect.y})`)

      // 发送 OS 级鼠标点击（sendInputEvent 生成真实 OS 事件）
      wc.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
      await new Promise((r) => setTimeout(r, 80))
      wc.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })

      // JS MouseEvent 兜底（Runway 是 React SPA，合成事件有时需要 JS 级事件）
      await new Promise((r) => setTimeout(r, 200))
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
              btns[i].click();
              return;
            }
          }
        })()
      `)
      console.log('[Adapter] Generate button clicked (OS + JS)')

      // 关闭点击后弹出的对话框（如有）
      await new Promise((r) => setTimeout(r, 1000))
      const dismissed = await this.dismissDialogs()
      if (dismissed > 0) console.log(`[Adapter] Dismissed ${dismissed} post-click dialogs`)
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
