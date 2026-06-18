/** 任务状态机 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

/** 任务优先级（Sprint 12 用到，当前默认 medium） */
export type TaskPriority = 'high' | 'medium' | 'low'

/** 任务实体 */
export interface Task {
  id: string
  prompt: string
  modelId: string
  status: TaskStatus
  priority: TaskPriority
  note: string
  retryCount: number
  createdAt: number
  updatedAt: number
  result?: string
  error?: string
  /** 视频时长（秒） */
  duration?: number
  /** 视频分辨率 */
  resolution?: string
  /** 画面比例 */
  aspectRatio?: string
}

/** 创建任务的参数 */
export interface CreateTaskParams {
  prompt: string
  modelId: string
  /** 关联的参考图 Material ID 列表 */
  materialIds?: string[]
  /** 视频时长（秒） */
  duration?: number
  /** 视频分辨率 */
  resolution?: string
  /** 画面比例 */
  aspectRatio?: string
}

/** 任务队列接口 */
export interface ITaskQueue {
  create(params: CreateTaskParams): Task
  getById(id: string): Task | null
  list(status?: TaskStatus): Task[]
  updateStatus(id: string, status: TaskStatus, error?: string): void
  delete(id: string): void
  retryTask(id: string): void
  start(): void
  stop(): void
}
