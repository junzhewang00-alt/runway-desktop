import { ipcMain } from 'electron'
import { logger } from '../../logs/logger'
import { withIpcTimeout } from './utils'

export function registerLoggerHandlers(): void {
  ipcMain.handle('logger:export', withIpcTimeout(async () => {
    return logger.exportLogs()
  }))
}
