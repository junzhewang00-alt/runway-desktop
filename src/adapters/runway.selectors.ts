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
  /** 主提示词输入框（支持 textarea / contenteditable / input，含 Runway Seedance 特定选择器） */
  /** 顺序重要：contenteditable 和 textbox class 优先，aria-label/placeholder 只匹配 wrapper 时靠钻取逻辑兜底 */
  promptInput: '[contenteditable="true"][class*="textbox"], [contenteditable="true"][aria-label*="Prompt"], [contenteditable="true"][aria-label*="prompt"], [contenteditable="true"], [aria-label*="Prompt"], [aria-label*="prompt"], [placeholder*="Describe"], [placeholder*="describe"]',

  // ── 生成按钮 ──
  /** 生成按钮 — 通过文本内容查找，不依赖 hash class */
  generateButtonText: 'Generate',

  // ── 状态检测 ──
  /** 生成状态容器 */
  statusContainer: '[data-testid*="generation"], [class*="progress"], [class*="status"]',

  // ── 参考图上传 ──
  /** 首帧图 / 参考图上传区域 (WAN 2.6 / Gen-4) */
  firstFrameUpload: '[class*="FirstFrame"], [class*="first-frame"], [class*="upload"], [class*="Upload"], [data-testid*="upload"] input[type="file"]',
  /** 文件上传隐藏 input */
  hiddenFileInput: 'input[type="file"]',
  /** Seedance 2.0 Multi-reference 参考槽位 */
  seedanceReferenceSlot: '[class*="reference"], [class*="Reference"], [class*="slot"], [class*="upload-slot"]',
  /** Seedance 2.0 "+ References" 按钮 */
  seedanceAddReference: '[class*="add"], [class*="Add"]',
} as const

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
