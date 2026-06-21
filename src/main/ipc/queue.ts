import { ipcMain } from 'electron'
import { taskQueue } from '../../queue/task.queue'
import { logger } from '../../logs/logger'
import { MODEL_CAPS } from '../../types/models'
import { withIpcTimeout } from './utils'

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

function validateParams(params: CreateTaskIPCParams): { valid: false; errors: string[] } | { valid: true } {
  const errors: string[] = []
  if (typeof params.prompt !== 'string' || params.prompt.trim().length === 0) {
    errors.push('Prompt is required')
  } else if (params.prompt.length > 5000) {
    errors.push(`Prompt exceeds 5000 char limit (${params.prompt.length})`)
  }
  const cap = MODEL_CAPS[params.modelId]
  if (!cap) {
    errors.push(`Unknown model: "${params.modelId}". Available: ${Object.keys(MODEL_CAPS).join(', ')}`)
    return { valid: false, errors }
  }
  if (params.duration !== undefined && !cap.durations.includes(params.duration)) {
    errors.push(`Duration ${params.duration}s not supported. Allowed: ${cap.durations.join(', ')}s`)
  }
  if (params.resolution && !cap.resolutions.includes(params.resolution)) {
    errors.push(`Resolution "${params.resolution}" not supported. Allowed: ${cap.resolutions.join(', ')}`)
  }
  if (params.aspectRatio && !cap.aspectRatios.includes(params.aspectRatio)) {
    errors.push(`Aspect ratio "${params.aspectRatio}" not supported. Allowed: ${cap.aspectRatios.join(', ')}`)
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

export function registerQueueHandlers(): void {
  ipcMain.handle('queue:create', withIpcTimeout((_event, params: CreateTaskIPCParams) => {
    const v = validateParams(params)
    if (!v.valid) {
      logger.warn('IPC', `queue:create rejected: ${v.errors.join('; ')}`)
      return { success: false as const, errors: v.errors }
    }
    const task = taskQueue.create(params)
    logger.info('IPC', `queue:create accepted: ${task.id.slice(0, 8)} model=${params.modelId}`)
    return { success: true as const, task }
  }))

  ipcMain.handle('queue:list', withIpcTimeout((_event, status?: string) => taskQueue.list(status as any)))

  ipcMain.handle('queue:updateStatus', withIpcTimeout((_event, id: string, status: string, error?: string) => {
    taskQueue.updateStatus(id, status as any, error)
  }))

  ipcMain.handle('queue:delete', withIpcTimeout((_event, id: string) => {
    taskQueue.delete(id)
  }))

  ipcMain.handle('queue:retry', withIpcTimeout((_event, id: string) => {
    taskQueue.retryTask(id)
  }))
}
