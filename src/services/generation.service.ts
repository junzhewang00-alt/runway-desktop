import { app, net, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import type { Task, CreateTaskParams } from '../types/tasks'
import { taskQueue } from '../queue/task.queue'
import { historyStore } from '../database/history.store'
import { materialStore } from '../database/material.store'
import { MODEL_CAPS } from '../types/models'
import type { IRunwayAdapter } from '../adapters/runway.adapter'
import type { ILogger } from '../logs/logger'

export interface IGenerationService {
  enqueueGeneration(params: CreateTaskParams): Promise<Task>
  pauseTask(taskId: string): Promise<void>
  resumeTask(taskId: string): Promise<void>
  cancelTask(taskId: string): Promise<void>
  getTasks(): Promise<Task[]>
}

export class GenerationService implements IGenerationService {
  private adapter: IRunwayAdapter | null = null
  private logger: ILogger | null = null

  /** 依赖注入 Adapter */
  setAdapter(adapter: IRunwayAdapter): void {
    this.adapter = adapter
  }

  /** 依赖注入 Logger */
  setLogger(logger: ILogger): void {
    this.logger = logger
  }

  async enqueueGeneration(params: CreateTaskParams): Promise<Task> {
    const task = taskQueue.create(params)
    this.logger?.info('Service', `Task enqueued: ${task.id}`, task.id)
    return task
  }

  async pauseTask(taskId: string): Promise<void> {
    const task = taskQueue.getById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (task.status !== 'running') throw new Error(`Cannot pause task in ${task.status} state`)
    taskQueue.updateStatus(taskId, 'pending')
    this.logger?.info('Service', `Task paused: ${taskId}`, taskId)
  }

  async resumeTask(taskId: string): Promise<void> {
    const task = taskQueue.getById(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (task.status !== 'pending') throw new Error(`Cannot resume task in ${task.status} state`)
    // 状态已经是 pending，队列 worker 会自动消费
    this.logger?.info('Service', `Task resumed: ${taskId}`, taskId)
  }

  async cancelTask(taskId: string): Promise<void> {
    taskQueue.delete(taskId)
    this.logger?.info('Service', `Task cancelled: ${taskId}`, taskId)
  }

  async getTasks(): Promise<Task[]> {
    return taskQueue.list()
  }

  /** 消费 pending 任务并提交到 Runway（不等待完成，由 monitor 回调 handleCompletion） */
  async executeGeneration(taskId: string): Promise<void> {
    if (!this.adapter) {
      taskQueue.updateStatus(taskId, 'failed', 'Adapter not configured')
      this.logger?.error('Service', 'Adapter not configured', taskId)
      return
    }

    const task = taskQueue.getById(taskId)
    if (!task) {
      this.logger?.error('Service', 'Task not found in DB', taskId)
      return
    }

    // ── 防重入保护 ──
    if (task.status !== 'running') {
      this.logger?.warn('Service', `Task status already changed to "${task.status}" before execution — skipping`, taskId)
      return
    }

    const submittedAt = new Date(task.createdAt).toISOString()
    const startedAt = new Date().toISOString()
    this.logger?.info('Service', `Task lifecycle: submitted=${submittedAt} started=${startedAt} model=${task.modelId}`, taskId)

    try {
      // 获取关联的参考图路径
      const imagePaths: string[] = []
      try {
        const linkedMaterials = materialStore.getByTaskId(taskId)
        imagePaths.push(...linkedMaterials.map((m) => m.filePath))
      } catch { /* materialStore 可能未初始化 */ }

      // 提交到 Runway（持锁时间短，仅页面交互）
      await this.adapter.submitOnly(
        taskId,
        task.modelId,
        task.prompt,
        imagePaths.length > 0 ? imagePaths : undefined,
        task.duration,
        task.resolution,
        task.aspectRatio,
      )
      this.logger?.info('Service', `Task submitted to Runway: ${taskId}`, taskId)
      // 完成由 CDP monitor 回调 handleCompletion()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failedAt = new Date().toISOString()
      taskQueue.updateStatus(taskId, 'failed', message)
      this.logger?.error('Service', `Submission failed: started=${startedAt} failedAt=${failedAt} error="${message}"`, taskId)
    }
  }

  /** 下载视频到本地 downloads 目录，带超时和单次重试 */
  private downloadVideo(taskId: string, videoUrl: string, retryCount = 0): void {
    const DOWNLOAD_TIMEOUT = 600_000 // 10 分钟超时（视频文件可能很大）
    const MAX_RETRIES = 1

    try {
      const downloadsDir = path.join(app.getPath('downloads'), 'runway-desktop')
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true })
      }

      const ext = videoUrl.match(/\.(mp4|webm|mov)(\?|$)/i)?.[1] || 'mp4'
      const filename = `${taskId.slice(0, 8)}_${Date.now()}.${ext}`
      const destPath = path.join(downloadsDir, filename)

      let timedOut = false
      const request = net.request(videoUrl)

      const timeoutId = setTimeout(() => {
        timedOut = true
        request.abort()
        this.logger?.warn('Service', `Download timeout after ${DOWNLOAD_TIMEOUT / 1000}s: ${taskId}`, taskId)
      }, DOWNLOAD_TIMEOUT)

      request.on('response', (response) => {
        if (timedOut) return
        const fileStream = fs.createWriteStream(destPath)
        response.on('data', (chunk: Buffer) => {
          const ok = fileStream.write(chunk)
          if (!ok) {
            response.pause()
            fileStream.once('drain', () => response.resume())
          }
        })
        response.on('end', () => {
          clearTimeout(timeoutId)
          fileStream.close()
          this.logger?.info('Service', `Video downloaded: ${destPath}`, taskId)
        })
        response.on('error', (err: Error) => {
          clearTimeout(timeoutId)
          fileStream.close()
          this.cleanupPartialFile(destPath)
          this.logger?.error('Service', `Download error: ${err.message}`, taskId)
          if (retryCount < MAX_RETRIES) {
            this.downloadVideo(taskId, videoUrl, retryCount + 1)
          }
        })
      })
      request.on('error', (err: Error) => {
        clearTimeout(timeoutId)
        this.cleanupPartialFile(destPath)
        this.logger?.error('Service', `Download request error: ${err.message}`, taskId)
        if (retryCount < MAX_RETRIES) {
          this.downloadVideo(taskId, videoUrl, retryCount + 1)
        }
      })
      request.end()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger?.error('Service', `Download setup error: ${msg}`, taskId)
    }
  }

  /** 删除不完整的下载文件 */
  private cleanupPartialFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch { /* 文件可能已被删除或未创建 */ }
  }

  private static readonly MAX_AUTO_RETRIES = 3
  /** 视频文件保留天数（超过后自动清理） */
  private static readonly DOWNLOAD_RETENTION_DAYS = 30

  /** CDP monitor 回调：处理生成完成结果 */
  handleCompletion(taskId: string, result: { status: string; videoUrl?: string; error?: string }): void {
    const task = taskQueue.getById(taskId)
    if (!task) {
      this.logger?.error('Service', 'handleCompletion: task not found', taskId)
      return
    }

    const completedAt = new Date().toISOString()
    if (result.status === 'completed') {
      taskQueue.updateStatus(taskId, 'completed')
      this.logger?.info('Service', `Task completed: ${taskId} completedAt=${completedAt} video=${result.videoUrl || 'none'}`, taskId)

      const modelCap = MODEL_CAPS[task.modelId]
      historyStore.insert({
        taskId: task.id,
        prompt: task.prompt,
        modelId: task.modelId,
        modelName: modelCap?.name ?? task.modelId,
        videoUrl: result.videoUrl,
        duration: task.duration,
        resolution: task.resolution,
        aspectRatio: task.aspectRatio,
      })

      // 自动下载视频
      if (result.videoUrl) {
        this.downloadVideo(task.id, result.videoUrl)
      }

      // 桌面通知
      try {
        const modelName = modelCap?.name ?? task.modelId
        const promptPreview = task.prompt.length > 60 ? task.prompt.slice(0, 60) + '...' : task.prompt
        new Notification({ title: `生成完成 — ${modelName}`, body: promptPreview }).show()
      } catch { /* 通知不可用 */ }
    } else {
      // 自动重试：临时故障（Runway 服务端过载等）自动重新入队
      if (task.retryCount < GenerationService.MAX_AUTO_RETRIES) {
        taskQueue.updateStatus(taskId, 'pending', result.error)
        const newCount = task.retryCount + 1
        this.logger?.warn('Service', `Task failed, auto-retry ${newCount}/${GenerationService.MAX_AUTO_RETRIES}: ${taskId} reason=${result.error}`, taskId)
      } else {
        taskQueue.updateStatus(taskId, 'failed', result.error)
        this.logger?.error('Service', `Task failed (retries exhausted): ${taskId} completedAt=${completedAt} reason=${result.error}`, taskId)
      }

      try {
        const modelCap = MODEL_CAPS[task.modelId]
        const modelName = modelCap?.name ?? task.modelId
        new Notification({ title: `生成失败 — ${modelName}`, body: result.error || '未知错误' }).show()
      } catch { /* 通知不可用 */ }
    }
  }

  /** 清理超过保留期的下载视频文件 */
  cleanupOldDownloads(): void {
    try {
      const downloadsDir = path.join(app.getPath('downloads'), 'runway-desktop')
      if (!fs.existsSync(downloadsDir)) return

      const cutoff = Date.now() - GenerationService.DOWNLOAD_RETENTION_DAYS * 86400_000
      const files = fs.readdirSync(downloadsDir)
      let removed = 0

      for (const file of files) {
        const filePath = path.join(downloadsDir, file)
        try {
          const stat = fs.statSync(filePath)
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath)
            removed++
          }
        } catch { /* 跳过无法访问的文件 */ }
      }

      if (removed > 0) {
        this.logger?.info('Service', `Cleaned ${removed} expired downloads (>${GenerationService.DOWNLOAD_RETENTION_DAYS}d)`)
      }
    } catch { /* 清理失败不应影响正常运行 */ }
  }
}

export const generationService = new GenerationService()
