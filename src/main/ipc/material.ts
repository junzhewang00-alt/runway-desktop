import { ipcMain, dialog } from 'electron'
import { materialService } from '../../services/material.service'
import { withIpcTimeout } from './utils'

let mainWindowGetter: (() => Electron.BrowserWindow | null) | null = null

export function setMainWindowGetter(getter: () => Electron.BrowserWindow | null): void {
  mainWindowGetter = getter
}

export function registerMaterialHandlers(): void {
  ipcMain.handle('material:openDialog', withIpcTimeout(async () => {
    const win = mainWindowGetter?.()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    return result.canceled ? [] : result.filePaths
  }))

  ipcMain.handle('material:import', withIpcTimeout(async (_event, { paths }: { paths: string[] }) => {
    return materialService.import(paths)
  }, 30_000))

  ipcMain.handle('material:list', withIpcTimeout(() => {
    return materialService.list()
  }))

  ipcMain.handle('material:delete', withIpcTimeout((_event, { id }: { id: string }) => {
    materialService.delete(id)
  }))
}
