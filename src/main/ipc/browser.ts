import { ipcMain } from 'electron'
import { browserManager } from '../../browser/browser.manager'
import { withIpcTimeout } from './utils'

export function registerBrowserHandlers(): void {
  ipcMain.handle('browser:refresh', withIpcTimeout(() => {
    browserManager.reload()
  }))

  ipcMain.handle('browser:openDevTools', withIpcTimeout(() => {
    browserManager.openDevTools()
  }))

  ipcMain.handle('browser:updateBounds', withIpcTimeout((_event, rect: { x: number; y: number; width: number; height: number }) => {
    browserManager.setBounds(rect.x, rect.y, rect.width, rect.height)
  }))

  ipcMain.handle('browser:hide', withIpcTimeout(() => {
    browserManager.hide()
  }))

  ipcMain.handle('browser:show', withIpcTimeout(() => {
    browserManager.show()
  }))

  ipcMain.handle('browser:setDarkMode', withIpcTimeout((_event, enabled: boolean) => {
    browserManager.setDarkMode(enabled)
  }))
}
