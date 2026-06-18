// BrowserView 预加载脚本 — 伪装 Chrome 浏览器指纹
// Runway 会检测非标准浏览器环境并降级为阉割版
// 此脚本在 Runway 页面代码执行前注入，隐藏 Electron 特征

// 1. 隐藏 webdriver 标记
Object.defineProperty(navigator, 'webdriver', { get: () => false })

// 2. 伪造 Chrome runtime 对象
;(window as any).chrome = {
  runtime: { id: 'fake-chrome-id' },
  loadTimes: () => ({}),
  csi: () => ({}),
  app: {},
}

// 3. 伪造 plugins（Chrome 有 PDF Viewer 等）
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const plugins: any[] = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ]
    plugins.item = (i: number) => plugins[i] || null
    plugins.namedItem = (name: string) => plugins.find((p) => p.name === name) || null
    plugins.refresh = () => {}
    Object.setPrototypeOf(plugins, PluginArray.prototype)
    return plugins
  },
  configurable: true,
})

// 4. 伪造 mimeTypes
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const mimeTypes: any[] = [
      { type: 'application/pdf', suffixes: 'pdf', description: '' },
      { type: 'text/pdf', suffixes: 'pdf', description: '' },
    ]
    mimeTypes.item = (i: number) => mimeTypes[i] || null
    mimeTypes.namedItem = (name: string) => mimeTypes.find((m) => m.type === name) || null
    Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype)
    return mimeTypes
  },
  configurable: true,
})

// 5. 伪造 languages（中文系统 + 英文）
Object.defineProperty(navigator, 'languages', {
  get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  configurable: true,
})

// 6. 伪装硬件并发数（至少 4 核）
Object.defineProperty(navigator, 'hardwareConcurrency', {
  get: () => 8,
  configurable: true,
})

// 7. 伪装 deviceMemory
Object.defineProperty(navigator as any, 'deviceMemory', {
  get: () => 8,
  configurable: true,
})

// 8. 伪装 platform 为 Win32
Object.defineProperty(navigator, 'platform', {
  get: () => 'Win32',
  configurable: true,
})

// 9. 添加 Chrome 特有属性
;(window as any).chrome = (window as any).chrome || {}
Object.assign((window as any).chrome, {
  app: {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
  },
  webstore: undefined,
})
