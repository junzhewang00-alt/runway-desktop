import { ipcMain } from 'electron'
import { runwayAdapter } from '../../adapters/runway.adapter'
import { withIpcTimeout } from './utils'

export function registerDebugHandlers(): void {
  ipcMain.handle('debug:diagnose', withIpcTimeout(async () => {
    return runwayAdapter.diagnosePage()
  }))
}
