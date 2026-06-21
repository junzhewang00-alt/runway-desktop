import { ipcMain } from 'electron'
import { historyStore } from '../../database/history.store'
import { logger } from '../../logs/logger'
import { MODEL_CAPS } from '../../types/models'
import { withIpcTimeout } from './utils'

export function registerHistoryHandlers(): void {
  ipcMain.handle('history:list', withIpcTimeout((_event, filter?: { modelId?: string; dateFrom?: number; dateTo?: number }, page?: number, pageSize?: number) => {
    if (filter?.modelId && !MODEL_CAPS[filter.modelId]) {
      logger.warn('IPC', `history:list rejected — unknown model: ${filter.modelId}`)
      return []
    }
    if (filter?.dateFrom !== undefined && typeof filter.dateFrom !== 'number') return []
    if (filter?.dateTo !== undefined && typeof filter.dateTo !== 'number') return []
    return historyStore.list(filter, page, pageSize)
  }))

  ipcMain.handle('history:getById', withIpcTimeout((_event, id: string) => {
    return historyStore.getById(id)
  }))
}
