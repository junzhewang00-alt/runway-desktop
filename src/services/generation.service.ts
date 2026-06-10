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
      await this.adapter.submitOnly(taskId, task.modelId, task.prompt, imagePaths.length > 0 ? imagePaths : undefined)
      this.logger?.info('Service', `Task submitted to Runway: ${taskId}`, taskId)
      // 完成由 CDP monitor 回调 handleCompletion()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failedAt = new Date().toISOString()
      taskQueue.updateStatus(taskId, 'failed', message)
      this.logger?.error('Service', `Submission failed: started=${startedAt} failedAt=${failedAt} error="${message}"`, taskId)
    }
  }

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
      })
    } else {
      taskQueue.updateStatus(taskId, 'failed', result.error)
      this.logger?.error('Service', `Task failed: ${taskId} completedAt=${completedAt} reason=${result.error}`, taskId)
    }
  }
}

export const generationService = new GenerationService()
