import { globalShortcut, BrowserWindow } from 'electron'

export function registerShortcuts(mainWindow: BrowserWindow): void {
  // Ctrl+N — 聚焦 Prompt 输入框
  globalShortcut.register('Ctrl+N', () => {
    mainWindow.webContents.send('shortcut:focus-prompt')
  })

  // Ctrl+R — 刷新 BrowserView（Runway 页面）
  globalShortcut.register('Ctrl+R', () => {
    mainWindow.webContents.send('shortcut:refresh-browser')
  })

  // Ctrl+E — 导出日志
  globalShortcut.register('Ctrl+E', () => {
    mainWindow.webContents.send('shortcut:export-logs')
  })

  // Ctrl+1/2/3 — 切换左侧面板
  globalShortcut.register('Ctrl+1', () => {
    mainWindow.webContents.send('shortcut:switch-panel', 'tasks')
  })
  globalShortcut.register('Ctrl+2', () => {
    mainWindow.webContents.send('shortcut:switch-panel', 'history')
  })
  globalShortcut.register('Ctrl+3', () => {
    mainWindow.webContents.send('shortcut:switch-panel', 'materials')
  })

  // Esc — 关闭弹窗/模态框
  globalShortcut.register('Esc', () => {
    mainWindow.webContents.send('shortcut:close-modal')
  })
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
