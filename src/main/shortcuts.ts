import { globalShortcut, BrowserWindow } from 'electron'

const mod = 'CommandOrControl' // macOS → Cmd, Windows/Linux → Ctrl

export function registerShortcuts(mainWindow: BrowserWindow): void {
  globalShortcut.register(`${mod}+N`, () => {
    mainWindow.webContents.send('shortcut:focus-prompt')
  })

  globalShortcut.register(`${mod}+R`, () => {
    mainWindow.webContents.send('shortcut:refresh-browser')
  })

  globalShortcut.register(`${mod}+E`, () => {
    mainWindow.webContents.send('shortcut:export-logs')
  })

  globalShortcut.register(`${mod}+1`, () => {
    mainWindow.webContents.send('shortcut:switch-panel', 'tasks')
  })
  globalShortcut.register(`${mod}+2`, () => {
    mainWindow.webContents.send('shortcut:switch-panel', 'history')
  })
  globalShortcut.register(`${mod}+3`, () => {
    mainWindow.webContents.send('shortcut:switch-panel', 'materials')
  })

  globalShortcut.register('Esc', () => {
    mainWindow.webContents.send('shortcut:close-modal')
  })
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
