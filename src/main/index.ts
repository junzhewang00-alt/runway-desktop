import { app, BrowserWindow, net, protocol, Menu } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { browserManager, BrowserManager } from '../browser/browser.manager'
import { sessionManager } from '../browser/session.manager'
import { taskQueue } from '../queue/task.queue'
import { generationService } from '../services/generation.service'
import { runwayAdapter } from '../adapters/runway.adapter'
import { logger } from '../logs/logger'
import { historyStore } from '../database/history.store'
import { materialStore } from '../database/material.store'
import { downloadManager } from '../download/download.manager'
import { databaseConnection } from '../database/connection'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { registerBrowserHandlers } from './ipc/browser'
import { registerSessionHandlers } from './ipc/session'
import { registerQueueHandlers } from './ipc/queue'
import { registerModelHandlers } from './ipc/models'
import { registerHistoryHandlers } from './ipc/history'
import { registerLoggerHandlers } from './ipc/logger'
import { registerMaterialHandlers, setMainWindowGetter } from './ipc/material'
import { registerDebugHandlers } from './ipc/debug'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Canvas',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Sprint 3: 注入 SessionManager
  browserManager.setSessionManager(sessionManager)

  // Sprint 2: 创建并附加 BrowserView
  browserManager.attachTo(mainWindow, {
    x: 280,
    y: 0,
    width: mainWindow.getContentSize()[0] - 600,
    height: mainWindow.getContentSize()[1],
  })

  browserManager.loadURL(BrowserManager.RUNWAY_URL)

  // Sprint 4: Adapter 注入 BrowserView
  runwayAdapter.setBrowserView(browserManager.getBrowserView())

  // Sprint 10: BrowserView crash 恢复后重新注入 Adapter
  browserManager.setOnRebuild((newBv) => {
    logger.warn('Browser', 'BrowserView rebuilt after crash')
    runwayAdapter.setBrowserView(newBv)
  })

  // Sprint 5+6: Service 注入 Adapter + Logger
  generationService.setAdapter(runwayAdapter)
  generationService.setLogger(logger)

  // Sprint 13: DownloadManager DI
  downloadManager.setLogger(logger)

  // ── 注册 Monitor 回调（必须在 monitor 启动之前）──
  runwayAdapter.setCompletionCallback((taskId, result) => {
    generationService.handleCompletion(taskId, result)
  })
  runwayAdapter.setSlotFreedCallback(() => {
    taskQueue.notifySlotFreed()
  })

  // ── 启动持久 CDP Monitor（必须在 queue 之前）──
  try {
    await runwayAdapter.startPersistentMonitor()
    logger.info('Main', 'CDP monitor started')
  } catch (err) {
    logger.warn('Main', `CDP monitor start failed: ${err}, will retry on first submit`)
  }

  // Sprint 5: 注入处理器、槽位检查器并启动队列消费
  taskQueue.setSlotChecker(() => runwayAdapter.getAvailableSlots())
  taskQueue.setProcessor((taskId) => generationService.executeGeneration(taskId))
  taskQueue.start()

  logger.info('Main', 'Application started')

  // 启动时清理过期下载文件
  generationService.cleanupOldDownloads()

  // Sprint 8: 日志推送至渲染进程
  logger.addListener((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log:new', entry)
    }
  })

  if (isDev) {
    const devURL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devURL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ── 注册所有 IPC Handlers ──
registerBrowserHandlers()
registerSessionHandlers()
registerQueueHandlers()
registerModelHandlers()
registerHistoryHandlers()
registerLoggerHandlers()
setMainWindowGetter(() => mainWindow)
registerMaterialHandlers()
registerDebugHandlers()

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // 素材库自定义协议
  protocol.handle('material-file', (request) => {
    const id = new URL(request.url).hostname
    const mat = materialStore.getById(id)
    if (!mat) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(mat.filePath).href)
  })

  createWindow()
  registerShortcuts(mainWindow!)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  try {
    unregisterShortcuts()
    taskQueue.stop()
    runwayAdapter.stopPersistentMonitor()
    databaseConnection.close()
  } catch (err) {
    console.error('[Main] Error during shutdown:', err)
  }
})

app.on('window-all-closed', () => {
  logger.info('Main', 'Application shutting down')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
