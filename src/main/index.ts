import { app, BrowserWindow, ipcMain, dialog, net, protocol, Menu } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { browserManager, BrowserManager } from '../browser/browser.manager'
import { sessionManager } from '../browser/session.manager'
import { taskQueue } from '../queue/task.queue'
import { generationService } from '../services/generation.service'
import { runwayAdapter } from '../adapters/runway.adapter'
import { logger } from '../logs/logger'
import { modelService } from '../services/model.service'
import { historyStore } from '../database/history.store'
import { materialStore } from '../database/material.store'
import { materialService } from '../services/material.service'
import { databaseConnection } from '../database/connection'
import type { TaskStatus } from '../types/tasks'
import { MODEL_CAPS } from '../types/models'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function withIpcTimeout<T>(
  handler: (...args: any[]) => Promise<T>,
  timeoutMs = 10_000,
): (...args: any[]) => Promise<T> {
  return (...args: any[]) => {
    return Promise.race([
      handler(...args),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('IPC timeout')), timeoutMs),
      ),
    ])
  }
}

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

  // ── 注册 Monitor 回调（必须在 monitor 启动之前，避免漏掉早期事件）──
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

  // 启动时清理过期下载文件（异步，不阻塞启动）
  generationService.cleanupOldDownloads()

  // Sprint 8: 日志推送至渲染进程
  logger.addListener((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log:new', entry)
    }
  })

  if (isDev) {
    // electron-vite 通过环境变量注入正确的 dev server URL
    const devURL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devURL)
    // DevTools 手动 Ctrl+Shift+I 打开，不自动弹出遮挡右侧面板
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ──── Validation ────

interface CreateTaskIPCParams {
  prompt: string
  modelId: string
  priority?: string
  note?: string
  materialIds?: string[]
  duration?: number
  resolution?: string
  aspectRatio?: string
}

interface ValidationErrors {
  valid: false
  errors: string[]
}

interface ValidationSuccess {
  valid: true
}

type ValidationResult = ValidationSuccess | ValidationErrors

/** 硬性上限：防止恶意超长 prompt 导致 executeJavaScript 截断或注入 */
const HARD_PROMPT_LIMIT = 5000

function validateCreateTaskParams(params: CreateTaskIPCParams): ValidationResult {
  const errors: string[] = []

  // 1. Validate prompt — non-empty, within bounds
  if (typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
    errors.push('Prompt is required and cannot be empty')
  } else if (params.prompt.length > HARD_PROMPT_LIMIT) {
    errors.push(
      `Prompt exceeds hard limit of ${HARD_PROMPT_LIMIT} characters (received ${params.prompt.length})`,
    )
  }

  // 2. Validate modelId — must exist in MODEL_CAPS
  const modelCap = MODEL_CAPS[params.modelId]
  if (!modelCap) {
    const knownModels = Object.keys(MODEL_CAPS).join(', ')
    errors.push(`Unknown model: "${params.modelId}". Available models: ${knownModels}`)
    // Cannot validate model-specific constraints without a recognized model
    return { valid: false, errors }
  }

  // 3. Validate prompt against model's maxPromptLength
  if (params.prompt && params.prompt.length > modelCap.maxPromptLength) {
    errors.push(
      `Prompt length (${params.prompt.length}) exceeds ${modelCap.name} limit of ${modelCap.maxPromptLength} characters`,
    )
  }

  // 4. Validate duration — must be a positive integer within model's allowed durations
  if (params.duration !== undefined && params.duration !== null) {
    if (
      typeof params.duration !== 'number' ||
      !Number.isInteger(params.duration) ||
      params.duration <= 0
    ) {
      errors.push(`Duration must be a positive integer, received: ${params.duration}`)
    } else if (!modelCap.durations.includes(params.duration)) {
      errors.push(
        `Duration ${params.duration}s is not supported by ${modelCap.name}. Allowed: ${modelCap.durations.join(', ')}s`,
      )
    }
  }

  // 5. Validate resolution — must be within model's allowed resolutions
  if (
    params.resolution !== undefined &&
    params.resolution !== null &&
    params.resolution !== ''
  ) {
    if (typeof params.resolution !== 'string') {
      errors.push(`Resolution must be a string, received: ${typeof params.resolution}`)
    } else if (!modelCap.resolutions.includes(params.resolution)) {
      errors.push(
        `Resolution "${params.resolution}" is not supported by ${modelCap.name}. Allowed: ${modelCap.resolutions.join(', ')}`,
      )
    }
  }

  // 6. Validate aspectRatio — must be within model's allowed aspect ratios
  if (
    params.aspectRatio !== undefined &&
    params.aspectRatio !== null &&
    params.aspectRatio !== ''
  ) {
    if (typeof params.aspectRatio !== 'string') {
      errors.push(`Aspect ratio must be a string, received: ${typeof params.aspectRatio}`)
    } else if (!modelCap.aspectRatios.includes(params.aspectRatio)) {
      errors.push(
        `Aspect ratio "${params.aspectRatio}" is not supported by ${modelCap.name}. Allowed: ${modelCap.aspectRatios.join(', ')}`,
      )
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true }
}

// ──── IPC Handlers ────

// Sprint 2 - Browser
ipcMain.handle('browser:refresh', withIpcTimeout(() => {
  browserManager.reload()
}))

ipcMain.handle('browser:openDevTools', withIpcTimeout(() => {
  browserManager.openDevTools()
}))

ipcMain.handle(
  'browser:updateBounds',
  withIpcTimeout((_event, rect: { x: number; y: number; width: number; height: number }) => {
    browserManager.setBounds(rect.x, rect.y, rect.width, rect.height)
  }),
)

ipcMain.handle('browser:hide', withIpcTimeout(() => {
  browserManager.hide()
}))

ipcMain.handle('browser:show', withIpcTimeout(() => {
  browserManager.show()
}))

// Sprint 3 - Session
ipcMain.handle('session:isLoggedIn', withIpcTimeout(async () => {
  return sessionManager.isLoggedIn()
}))

ipcMain.handle('session:clear', withIpcTimeout(async () => {
  await sessionManager.clearSession()
}))

// Sprint 5 - Queue
ipcMain.handle('queue:create', withIpcTimeout((_event, params: CreateTaskIPCParams) => {
  const validation = validateCreateTaskParams(params)
  if (!validation.valid) {
    logger.warn('IPC', `queue:create rejected: ${validation.errors.join('; ')}`)
    return { success: false as const, errors: validation.errors }
  }
  const task = taskQueue.create(params)
  logger.info('IPC', `queue:create accepted: ${task.id.slice(0, 8)} model=${params.modelId}`)
  return { success: true as const, task }
}))

ipcMain.handle('queue:list', withIpcTimeout((_event, status?: TaskStatus) => {
  return taskQueue.list(status)
}))

ipcMain.handle(
  'queue:updateStatus',
  withIpcTimeout((_event, id: string, status: TaskStatus, error?: string) => {
    taskQueue.updateStatus(id, status, error)
  }),
)

ipcMain.handle('queue:delete', withIpcTimeout((_event, id: string) => {
  taskQueue.delete(id)
}))

// Sprint 10 - Queue retry
ipcMain.handle('queue:retry', withIpcTimeout((_event, id: string) => {
  taskQueue.retryTask(id)
}))

// Sprint 7 - Models
ipcMain.handle('models:list', withIpcTimeout(() => {
  return modelService.getModels()
}))

// Sprint 11 - History
ipcMain.handle('history:list', withIpcTimeout((_event, filter?: { modelId?: string; dateFrom?: number; dateTo?: number }, page?: number, pageSize?: number) => {
  if (filter?.modelId && !MODEL_CAPS[filter.modelId]) {
    logger.warn('IPC', `history:list rejected — unknown model: ${filter.modelId}`)
    return []
  }
  if (filter?.dateFrom !== undefined && typeof filter.dateFrom !== 'number') {
    logger.warn('IPC', `history:list rejected — invalid dateFrom: ${filter.dateFrom}`)
    return []
  }
  if (filter?.dateTo !== undefined && typeof filter.dateTo !== 'number') {
    logger.warn('IPC', `history:list rejected — invalid dateTo: ${filter.dateTo}`)
    return []
  }
  return historyStore.list(filter, page, pageSize)
}))

ipcMain.handle('history:getById', withIpcTimeout((_event, id: string) => {
  return historyStore.getById(id)
}))

// Sprint 6 - Logger export
ipcMain.handle('logger:export', withIpcTimeout(async () => {
  return logger.exportLogs()
}))

// Material — 素材库
ipcMain.handle('material:openDialog', withIpcTimeout(async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
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

// Debug - 诊断 Runway 页面元素
ipcMain.handle('debug:diagnose', withIpcTimeout(async () => {
  const result = await runwayAdapter.diagnosePage()
  logger.info('Debug', 'Page elements dumped')
  return result
}))

app.whenReady().then(() => {
  // 移除默认菜单栏
  Menu.setApplicationMenu(null)

  // 素材库自定义协议 — 在 createWindow 之前注册（session 要求 ready 后）
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
