import { v4 as uuidv4 } from 'uuid'
import { databaseConnection } from '../database/connection'
import { materialStore } from '../database/material.store'
import type { Task, TaskStatus, TaskPriority, CreateTaskParams } from '../types/tasks'
import { runwayAdapter } from '../adapters/runway.adapter'

export type TaskProcessor = (taskId: string) => Promise<void>

interface CreateParams extends CreateTaskParams {
  priority?: TaskPriority
  note?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
}

/** Runway 同一时间最多支持 2 个并发生成（回退默认值，实际由 RunwayAdapter 控制） */
const MAX_RUNWAY_SLOTS = 2

export class TaskQueue {
  private running = false
  private processor: TaskProcessor | null = null
  private runningTaskIds: Set<string> = new Set()
  private getAvailableSlots: (() => number) | null = null
  private slotFreedResolve: (() => void) | null = null

  setProcessor(processor: TaskProcessor): void {
    this.processor = processor
  }

  /** 注入 Runway 槽位查询函数（由 main/index.ts 在 DI 时调用） */
  setSlotChecker(fn: () => number): void {
    this.getAvailableSlots = fn
  }

  /** 当 Runway Monitor 检测到生成完成时调用，提前唤醒 worker loop */
  notifySlotFreed(): void {
    if (this.slotFreedResolve) {
      this.slotFreedResolve()
      this.slotFreedResolve = null
    }
  }

  create(params: CreateParams): Task {
    const db = databaseConnection.getDb()
    const task: Task = {
      id: uuidv4(),
      prompt: params.prompt,
      modelId: params.modelId,
      status: 'pending',
      priority: params.priority ?? 'medium',
      note: params.note ?? '',
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      duration: params.duration,
      resolution: params.resolution,
      aspectRatio: params.aspectRatio,
    }

    db.prepare(
      `INSERT INTO tasks (id, prompt, model_id, status, priority, note, retry_count, created_at, updated_at, duration, resolution, aspect_ratio)
       VALUES (@id, @prompt, @modelId, @status, @priority, @note, @retryCount, @createdAt, @updatedAt, @duration, @resolution, @aspectRatio)`,
    ).run({
      id: task.id,
      prompt: task.prompt,
      modelId: task.modelId,
      status: task.status,
      priority: task.priority,
      note: task.note,
      retryCount: task.retryCount,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      duration: task.duration ?? null,
      resolution: task.resolution ?? null,
      aspectRatio: task.aspectRatio ?? null,
    })

    // 绑定参考图
    if (params.materialIds && params.materialIds.length > 0) {
      for (const materialId of params.materialIds) {
        materialStore.linkTask(task.id, materialId)
      }
    }

    return task
  }

  getById(id: string): Task | null {
    const db = databaseConnection.getDb()
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return this.rowToTask(row)
  }

  list(status?: TaskStatus): Task[] {
    const db = databaseConnection.getDb()
    let rows: Record<string, unknown>[]
    if (status) {
      rows = db
        .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT 500')
        .all(status) as Record<string, unknown>[]
    } else {
      rows = db
        .prepare('SELECT * FROM tasks ORDER BY created_at ASC LIMIT 500')
        .all() as Record<string, unknown>[]
    }
    return rows.map((r) => this.rowToTask(r))
  }

  updateStatus(id: string, status: TaskStatus, error?: string): void {
    const db = databaseConnection.getDb()
    db.prepare(
      `UPDATE tasks SET status = @status, updated_at = @updatedAt, error = @error
       WHERE id = @id`,
    ).run({ id, status, updatedAt: Date.now(), error: error ?? null })
  }

  delete(id: string): void {
    const db = databaseConnection.getDb()
    // 先清理关联记录（FK 约束要求）
    db.prepare('DELETE FROM generations WHERE task_id = ?').run(id)
    try { db.prepare('DELETE FROM task_materials WHERE task_id = ?').run(id) } catch { /* 素材表暂未创建 */ }
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  /** 重试失败任务：重置为 pending，worker 自动消费 */
  retryTask(id: string): void {
    const task = this.getById(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    if (task.status !== 'failed') throw new Error('Can only retry failed tasks')

    const db = databaseConnection.getDb()
    db.prepare(
      `UPDATE tasks SET status = 'pending', error = NULL, retry_count = retry_count + 1, updated_at = @updatedAt WHERE id = @id`,
    ).run({ id, updatedAt: Date.now() })
  }

  start(): void {
    if (this.running) return
    this.markOrphanedRunningTasks()
    this.running = true
    this.workerLoop()
  }

  /** 将上次会话遗留的 running 状态任务标记为 failed（可手动重试） */
  private markOrphanedRunningTasks(): void {
    const db = databaseConnection.getDb()
    const result = db.prepare(
      `UPDATE tasks SET status = 'failed', error = 'App restarted before completion — retry manually', updated_at = @updatedAt
       WHERE status = 'running'`,
    ).run({ updatedAt: Date.now() })
    if (result.changes > 0) {
      console.log(`[Queue] Marked ${result.changes} orphaned running task(s) as failed`)
    }
  }

  stop(): void {
    this.running = false
  }

  /** 异步消费循环：维持最多 MAX_RUNWAY_SLOTS 个任务在 Runway 上并发生成 */
  private async workerLoop(): Promise<void> {
    while (this.running) {
      try {
        if (!this.processor) {
          await this.delay(2000)
          continue
        }

        // 检查 Runway 槽位（由 adapter 提供实际值）
        const availableSlots = this.getAvailableSlots?.() ?? MAX_RUNWAY_SLOTS
        if (availableSlots <= 0) {
          console.log('[Queue] No Runway slots available, waiting...')
          // 等待 notifySlotFreed 唤醒（带超时兜底，防止唤醒丢失）
          await new Promise<void>((resolve) => {
            this.slotFreedResolve = resolve
            setTimeout(() => {
              if (this.slotFreedResolve === resolve) {
                this.slotFreedResolve = null
                resolve()
              }
            }, 5000)
          })
          continue
        }

        const db = databaseConnection.getDb()
        const row = db
          .prepare(
            `SELECT * FROM tasks WHERE status = 'pending'
             ORDER BY
               CASE priority
                 WHEN 'high' THEN 1
                 WHEN 'medium' THEN 2
                 WHEN 'low' THEN 3
               END,
               created_at ASC
             LIMIT 1`,
          )
          .get() as Record<string, unknown> | undefined

        if (!row) {
          await this.delay(2000)
          continue
        }

        const task = this.rowToTask(row)
        const taskId = task.id
        this.updateStatus(taskId, 'running')
        this.runningTaskIds.add(taskId)

        console.log(`[Queue] Task started: ${taskId.slice(0, 8)} (${task.modelId}) [Runway slots: ${this.getAvailableSlots?.() ?? '?'}/${MAX_RUNWAY_SLOTS}, local running: ${this.runningTaskIds.size}]`)

        runwayAdapter.notifyTaskActive()

        // 不 await — 让任务在后台提交
        this.processor(taskId)
          .then(() => {
            console.log(`[Queue] Task submitted: ${taskId.slice(0, 8)}`)
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[Queue] Task crashed: ${taskId.slice(0, 8)} — ${message}`)
            const t = this.getById(taskId)
            if (t && t.status === 'running') {
              this.updateStatus(taskId, 'failed', `Unhandled processor error: ${message}`)
            }
          })
          .finally(() => {
            this.runningTaskIds.delete(taskId)
            if (this.runningTaskIds.size === 0) {
              runwayAdapter.notifyTaskIdle()
            }
          })

        // 短暂延迟防止同次循环内重复拾取
        await this.delay(100)
      } catch (loopErr) {
        console.error('[Queue] Worker loop error:', loopErr)
        await this.delay(2000)
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  /** 获取当前正在运行的任务数 */
  getRunningCount(): number {
    return this.runningTaskIds.size
  }

  /** 获取当前是否正在处理任务 */
  isProcessing(): boolean {
    return this.runningTaskIds.size > 0
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      prompt: row.prompt as string,
      modelId: row.model_id as string,
      status: row.status as TaskStatus,
      priority: (row.priority as Task['priority']) ?? 'medium',
      note: (row.note as string) ?? '',
      retryCount: (row.retry_count as number) ?? 0,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      result: row.result as string | undefined,
      error: row.error as string | undefined,
      duration: row.duration as number | undefined,
      resolution: row.resolution as string | undefined,
      aspectRatio: row.aspect_ratio as string | undefined,
    }
  }
}

export const taskQueue = new TaskQueue()
