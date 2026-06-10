import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Sprint 5: Queue API
  queue: {
    create: (params: { prompt: string; modelId: string; priority?: string; note?: string; materialIds?: string[] }) =>
      ipcRenderer.invoke('queue:create', params),
    list: (status?: string) => ipcRenderer.invoke('queue:list', status),
    updateStatus: (id: string, status: string, error?: string) =>
      ipcRenderer.invoke('queue:updateStatus', id, status, error),
    delete: (id: string) => ipcRenderer.invoke('queue:delete', id),
    retry: (id: string) => ipcRenderer.invoke('queue:retry', id),
  },

  // Sprint 6: Logger API
  onLog: (callback: (entry: LogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) =>
      callback(entry)
    ipcRenderer.on('log:new', handler)
    return () => ipcRenderer.removeListener('log:new', handler)
  },

  // Sprint 2: Browser API
  browser: {
    refresh: () => ipcRenderer.invoke('browser:refresh'),
    openDevTools: () => ipcRenderer.invoke('browser:openDevTools'),
    updateBounds: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('browser:updateBounds', rect),
  },

  // Sprint 3: Session API
  session: {
    isLoggedIn: () => ipcRenderer.invoke('session:isLoggedIn'),
    clear: () => ipcRenderer.invoke('session:clear'),
  },

  // Sprint 7: Model API
  models: {
    list: () => ipcRenderer.invoke('models:list'),
  },

  // Sprint 11: History API
  history: {
    list: (filter?: { modelId?: string; dateFrom?: number; dateTo?: number }) =>
      ipcRenderer.invoke('history:list', filter),
    getById: (id: string) => ipcRenderer.invoke('history:getById', id),
  },

  // Sprint 6: Logger export
  logger: {
    export: () => ipcRenderer.invoke('logger:export'),
  },

  // Debug
  debug: {
    diagnose: () => ipcRenderer.invoke('debug:diagnose'),
  },

  // Material
  material: {
    openDialog: () => ipcRenderer.invoke('material:openDialog'),
    import: (paths: string[]) => ipcRenderer.invoke('material:import', { paths }),
    list: () => ipcRenderer.invoke('material:list'),
    delete: (id: string) => ipcRenderer.invoke('material:delete', { id }),
  },
}

export interface LogEntry {
  timestamp: string
  taskId?: string
  module: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('electronAPI', api)
