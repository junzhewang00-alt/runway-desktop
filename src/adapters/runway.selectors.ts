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
  /** 主提示词输入框（支持 textarea / contenteditable / input） */
  promptInput: 'textarea, [contenteditable="true"], input[type="text"]',

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

/** 通过可见文本查找按钮的 JS 代码片段 */
export function findButtonByTextJS(text: string): string {
  return `(function() {
    const btns = document.querySelectorAll('button, [role="button"]');
    for (const btn of btns) {
      if (btn.offsetParent !== null && (btn.textContent || '').trim() === ${JSON.stringify(text)}) {
        return true;
      }
    }
    return false;
  })()`
}

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
