import { ipcMain } from 'electron'
import { modelService } from '../../services/model.service'
import { withIpcTimeout } from './utils'

export function registerModelHandlers(): void {
  ipcMain.handle('models:list', withIpcTimeout(() => {
    return modelService.getModels()
  }))
}
