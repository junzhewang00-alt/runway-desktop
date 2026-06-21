import { ipcMain } from 'electron'
import { runwayAdapter } from '../../adapters/runway.adapter'
import { downloadManager } from '../../download/download.manager'
import { withIpcTimeout } from './utils'

export function registerDebugHandlers(): void {
  ipcMain.handle('debug:diagnose', withIpcTimeout(async () => {
    return runwayAdapter.diagnosePage()
  }))

  // Download progress
  ipcMain.handle('download:getProgress', withIpcTimeout((_event, taskId: string) => {
    return downloadManager.getProgress(taskId)
  }))
}
