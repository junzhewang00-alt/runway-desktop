import { ipcMain } from 'electron'
import { sessionManager } from '../../browser/session.manager'
import { withIpcTimeout } from './utils'

export function registerSessionHandlers(): void {
  ipcMain.handle('session:isLoggedIn', withIpcTimeout(async () => {
    return sessionManager.isLoggedIn()
  }))

  ipcMain.handle('session:clear', withIpcTimeout(async () => {
    await sessionManager.clearSession()
  }))
}
