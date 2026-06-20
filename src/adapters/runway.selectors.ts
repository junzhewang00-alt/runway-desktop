/**
 * Runway 网页 DOM 选择器集中配置
 *
 * 所有选择器在此文件定义，RunwayAdapter 方法引用这些常量。
 * Runway 页面更新时只需修改此文件。
 *
 * 基于实际 Runway 页面诊断结果（2026-06-08）
 */

export const RUNWAY_SELECTORS = {
  // ── 模型选择 ──
  /** 模型下拉按钮 */
  modelDropdown: '[data-testid="select-base-model"]',

  // ── Prompt 输入 ──
  /** 主提示词输入框 */
  promptInput: '[contenteditable="true"][class*="textbox"], [contenteditable="true"][aria-label*="Prompt"], [contenteditable="true"][aria-label*="prompt"], [contenteditable="true"], [aria-label*="Prompt"], [aria-label*="prompt"], [placeholder*="Describe"], [placeholder*="describe"]',

  // ── 生成按钮 ──
  generateButtonText: 'Generate',

  // ── 状态检测 ──
  statusContainer: '[data-testid*="generation"], [class*="progress"], [class*="status"]',

  // ── 参考图上传 ──
  firstFrameUpload: '[class*="FirstFrame"], [class*="first-frame"], [class*="upload"], [class*="Upload"], [data-testid*="upload"] input[type="file"]',
  hiddenFileInput: 'input[type="file"]',
  seedanceReferenceSlot: '[class*="reference"], [class*="Reference"], [class*="slot"], [class*="upload-slot"]',
  seedanceAddReference: '[class*="add"], [class*="Add"]',

  // ── 槽位（并发管理）──
  emptySlotContainer: 'div[class*="emptySlotContainer-"]',
  slotButton: 'button[class*="slot-"][aria-label*="View IMG"]',
  slotAny: '[class*="slot-"]',

  // ── 上传区域 ──
  uploadArea: '[class*="upload-area"], [class*="Upload"]',
  dropZone: '[class*="dropzone"], [class*="DropZone"]',

  // ── 视频参数控制 ──
  /** Duration / Resolution / Aspect ratio 触发按钮 */
  durationButton: 'button[aria-label="Duration"]',
  sliderRoot: '[class*="Slider__Root"]',
  sliderTrack: '[class*="Slider__Track"]',

  // ── 下拉菜单通用 ──
  /** 弹出菜单容器 */
  dropdownContainer: [
    '[role="listbox"]', '[role="menu"]',
    '[class*="popover"]', '[class*="Popover"]',
    '[class*="dropdown"]', '[class*="Dropdown"]',
    '[class*="menu"]', '[class*="Menu"]',
    '[class*="panel"]', '[class*="Panel"]',
  ].join(', '),

  // ── 会话/文件夹 ──
  folderContainer: '.folderContainer-aV_LJB',

  // ── CDP Monitor 完成检测 ──
  /** 生成条目容器 */
  generationItems: [
    '[class*="Generation"]', '[class*="generation"]',
    '[class*="AssetItem"]', '[class*="assetItem"]',
    '[class*="HistoryItem"]', '[class*="historyItem"]',
    '[data-testid*="generation"]', '[data-testid*="asset"]',
  ].join(', '),
  /** 视频/进度回退检测 */
  videoProgressFallback: [
    'video',
    '[class*="progress"]', '[class*="Progress"]',
    '[class*="status"]', '[class*="Status"]',
    'progress', '[role="progressbar"]',
  ].join(', '),

  // ── 失败/错误检测 ──
  errorIndicators: '[class*="error"], [class*="Error"], [class*="failed"]',

  // ── 模态/弹窗/对话框 ──
  modalOverlay: [
    '[role="dialog"]', '[role="alertdialog"]',
    '[class*="modal"]', '[class*="Modal"]',
    '[class*="dialog"]', '[class*="Dialog"]',
    '[class*="overlay"]', '[class*="Overlay"]',
    '[class*="backdrop"]', '[class*="Backdrop"]',
    '[class*="popup"]', '[class*="Popup"]',
    '[class*="popover"]', '[class*="Popover"]',
    '[class*="drawer"]', '[class*="Drawer"]',
    '[class*="toast"]', '[class*="Toast"]',
  ].join(', '),

  /** 关闭/取消按钮 */
  closeButtons: [
    '[aria-label="Close"]', '[aria-label="close"]',
    '[data-testid="close"]',
    'button[class*="close"]', 'button[class*="Close"]',
    'button[class*="Dismiss"]',
  ].join(', '),

  // ── 通用可点击元素 ──
  /** 所有可点击按钮 */
  clickableElements: 'button, [role="button"], a[role="button"], input[type="submit"], input[type="button"]',
  /** 简单按钮（不含链接） */
  buttons: 'button, [role="button"]',
  /** 带链接的按钮 */
  buttonsWithLinks: 'button, [role="button"], a',
  /** 选项/菜单项 */
  optionItems: '[role="option"], [role="menuitem"]',
  /** 组合框触发器 */
  comboboxTriggers: 'button, [role="button"], [role="combobox"]',
} as const

// ── Runway 团队配置 ──

/** Runway 团队 slug — 从环境变量 RUNWAY_TEAM 读取，默认 'junzhewang00'（向后兼容） */
export function getRunwayTeamSlug(): string {
  return process.env['RUNWAY_TEAM'] || 'junzhewang00'
}

/** 构建 Runway 生成页面完整 URL。extraParams 会追加为查询参数。 */
export function getRunwayURL(extraParams?: Record<string, string>): string {
  const teamSlug = getRunwayTeamSlug()
  const base = `https://app.runwayml.com/video-tools/teams/${teamSlug}/ai-tools/generate?mode=tools&tool=video`
  if (!extraParams || Object.keys(extraParams).length === 0) {
    return base
  }
  const extra = Object.entries(extraParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${base}&${extra}`
}

/** Adapter 操作超时（毫秒） */
export const ADAPTER_TIMEOUT = 30_000

/** checkStatus 轮询间隔（毫秒） */
export const POLL_INTERVAL = 2_000

/** waitForCompletion 最大等待时间（毫秒） */
export const MAX_WAIT_TIME = 5 * 60 * 1000

// ── 工具函数（在 executeJavaScript 中使用） ──

/** 点击可见文本匹配的按钮的 JS 代码片段
 *  跳过 disabled 按钮，使用 MouseEvent 确保 React 能捕获 */
export function clickButtonByTextJS(text: string): string {
  return `(function() {
    const btns = document.querySelectorAll('button, [role="button"], a[role="button"], input[type="submit"], input[type="button"]');
    for (const btn of btns) {
      if (btn.offsetParent !== null && !btn.disabled && (btn.textContent || btn.value || '').trim() === ${JSON.stringify(text)}) {
        const rect = btn.getBoundingClientRect();
        btn.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          button: 0,
        }));
        // 兼容兜底：原生 click 也触发一次
        btn.click();
        return true;
      }
    }
    return false;
  })()`
}

// ── 视频参数选择 ──

/** 通过标签文本（如 "Duration"、"Resolution"、"Aspect ratio"）查找设置行中的值按钮并点击 */
export function clickSettingByLabelJS(label: string): string {
  return `(function() {
    var lower = ${JSON.stringify(label.toLowerCase())};
    var all = document.querySelectorAll('*');
    // 第一遍：找包含标签文本的可见元素（如 "Duration" 标签）
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.offsetParent === null) continue;
      if (el.children.length > 0) continue;
      var t = (el.textContent || '').trim().toLowerCase();
      if (t === lower) {
        // 找到标签后，在附近查找可点击的值元素（同级的按钮或下拉触发器）
        var parent = el.parentElement;
        if (!parent) continue;
        // 先在父级内找按钮
        var btns = parent.querySelectorAll('button, [role="button"], [role="combobox"], [aria-haspopup], select');
        for (var j = 0; j < btns.length; j++) {
          if (btns[j].offsetParent !== null) {
            btns[j].click();
            return true;
          }
        }
        // 在父级兄弟中找
        var siblings = parent.parentElement ? parent.parentElement.children : [];
        for (var k = 0; k < siblings.length; k++) {
          var sibBtns = siblings[k].querySelectorAll('button, [role="button"], [role="combobox"], [aria-haspopup], select');
          for (var m = 0; m < sibBtns.length; m++) {
            if (sibBtns[m].offsetParent !== null) {
              sibBtns[m].click();
              return true;
            }
          }
        }
      }
    }
    // 第二遍：用标签文本的一部分匹配（如 "Duration" 可能嵌套在 span 中）
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.offsetParent === null) continue;
      var t = (el.textContent || '').trim().toLowerCase();
      if (t.indexOf(lower) >= 0 && t.length < 50 && el.children.length <= 1) {
        var region = el.closest('[class*="row"], [class*="Row"], [class*="control"], [class*="Control"], [class*="field"], [class*="Field"], [class*="group"], [class*="Group"]');
        var searchRoot = region || el.parentElement;
        if (!searchRoot) continue;
        var btns = searchRoot.querySelectorAll('button, [role="button"], [role="combobox"], [aria-haspopup], select');
        for (var j = 0; j < btns.length; j++) {
          if (btns[j].offsetParent !== null && btns[j] !== el) {
            btns[j].click();
            return true;
          }
        }
      }
    }
    return false;
  })()`
}

/** 通过值文本（如 "5s"、"720p"、"16:9"）查找并点击对应的触发器 */
export function clickValueChipByTextJS(text: string): string {
  return `(function() {
    var target = ${JSON.stringify(text)};
    var lower = target.toLowerCase();
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.offsetParent === null) continue;
      if (el.children.length > 0) continue;
      var t = (el.textContent || '').trim();
      if (t.toLowerCase() === lower) {
        // 检查是否可点击（button/role）或父级可点击
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.onclick) {
          el.click();
          return true;
        }
        var btn = el.closest('button, [role="button"], [role="combobox"]');
        if (btn) { btn.click(); return true; }
        // 直接 click 作为兜底
        el.click();
        return true;
      }
    }
    return false;
  })()`
}

/** 通过文本查找下拉选项中匹配的项并点击
 *  匹配策略：分隔符拆分后精确匹配 > 文本开头匹配 > 包含匹配
 *  Runway 模型文本格式: "WAN 2.6•Image/Text to Video, Audio" */
export function clickOptionByTextJS(text: string): string {
  return `(function() {
    const target = ${JSON.stringify(text)};
    const lower = target.toLowerCase();
    const items = document.querySelectorAll('[role="option"], [role="menuitem"], [data-value], li, .option, [class*="option"], [class*="item"]');
    const SEP = /[•\\-–|,]/;

    // 第一遍：用分隔符拆分文本，任一部分精确匹配（Runway 模型选项格式适配）
    for (const item of items) {
      if (item.offsetParent !== null) {
        const itemText = (item.textContent || '').trim();
        const parts = itemText.split(SEP).map(s => s.trim());
        for (const part of parts) {
          if (part.toLowerCase() === lower) {
            item.click();
            return true;
          }
        }
      }
    }
    // 第二遍：完整文本精确匹配
    for (const item of items) {
      if (item.offsetParent !== null) {
        const itemText = (item.textContent || '').trim();
        if (itemText.toLowerCase() === lower) {
          item.click();
          return true;
        }
      }
    }
    // 第三遍：包含匹配（兜底）
    for (const item of items) {
      if (item.offsetParent !== null) {
        const itemText = (item.textContent || '').trim();
        if (itemText.toLowerCase().includes(lower)) {
          item.click();
          return true;
        }
      }
    }
    // 最终兜底：查找任何可见元素
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.offsetParent !== null && el.children.length === 0) {
        const elText = (el.textContent || '').trim();
        const parts = elText.split(SEP).map(s => s.trim());
        for (const part of parts) {
          if (part.toLowerCase() === lower) { el.click(); return true; }
        }
        if (elText.toLowerCase() === lower) { el.click(); return true; }
      }
    }
    return false;
  })()`
}
