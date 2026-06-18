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
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
