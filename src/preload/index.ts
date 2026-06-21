import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Sprint 5: Queue API
  queue: {
    create: (params: { prompt: string; modelId: string; priority?: string; note?: string; materialIds?: string[]; duration?: number; resolution?: string; aspectRatio?: string }) =>
      ipcRenderer.invoke('queue:create', params),
    list: (status?: string) => ipcRenderer.invoke('queue:list', status),
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
    hide: () => ipcRenderer.invoke('browser:hide'),
    show: () => ipcRenderer.invoke('browser:show'),
    setDarkMode: (enabled: boolean) => ipcRenderer.invoke('browser:setDarkMode', enabled),
  },

  // Sprint 3: Session API
  session: {
    isLoggedIn: () => ipcRenderer.invoke('session:isLoggedIn'),
  },

  // Sprint 7: Model API
  models: {
    list: () => ipcRenderer.invoke('models:list'),
  },

  // Sprint 11: History API
  history: {
    list: (filter?: { modelId?: string; dateFrom?: number; dateTo?: number }, page?: number, pageSize?: number) =>
      ipcRenderer.invoke('history:list', filter, page, pageSize),
  },

  // Sprint 6: Logger export
  logger: {
    export: () => ipcRenderer.invoke('logger:export'),
  },

  // Debug
  debug: {
    diagnose: () => ipcRenderer.invoke('debug:diagnose'),
  },

  // Download
  download: {
    getProgress: (taskId: string) => ipcRenderer.invoke('download:getProgress', taskId),
  },

  // Sprint 14: Shortcuts
  shortcuts: {
    onFocusPrompt: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('shortcut:focus-prompt', handler)
      return () => ipcRenderer.removeListener('shortcut:focus-prompt', handler)
    },
    onRefreshBrowser: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('shortcut:refresh-browser', handler)
      return () => ipcRenderer.removeListener('shortcut:refresh-browser', handler)
    },
    onExportLogs: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('shortcut:export-logs', handler)
      return () => ipcRenderer.removeListener('shortcut:export-logs', handler)
    },
    onSwitchPanel: (cb: (tab: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tab: string) => cb(tab)
      ipcRenderer.on('shortcut:switch-panel', handler)
      return () => ipcRenderer.removeListener('shortcut:switch-panel', handler)
    },
    onCloseModal: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('shortcut:close-modal', handler)
      return () => ipcRenderer.removeListener('shortcut:close-modal', handler)
    },
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
