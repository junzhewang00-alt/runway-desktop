const uuidv4 = (): string => crypto.randomUUID()
import { databaseConnection } from './connection'

export interface Generation {
  id: string
  taskId: string
  prompt: string
  modelId: string
  modelName: string
  videoUrl?: string
  thumbnailPath?: string
  status: string
  createdAt: number
  duration?: number
  resolution?: string
  aspectRatio?: string
}

export interface CreateGenerationParams {
  taskId: string
  prompt: string
  modelId: string
  modelName: string
  videoUrl?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
}

export class HistoryStore {
  insert(params: CreateGenerationParams): Generation {
    const db = databaseConnection.getDb()
    const gen: Generation = {
      id: uuidv4(),
      taskId: params.taskId,
      prompt: params.prompt,
      modelId: params.modelId,
      modelName: params.modelName,
      videoUrl: params.videoUrl,
      status: 'completed',
      createdAt: Date.now(),
      duration: params.duration,
      resolution: params.resolution,
      aspectRatio: params.aspectRatio,
    }

    db.prepare(
      `INSERT INTO generations (id, task_id, prompt, model_id, model_name, video_url, thumbnail_path, status, created_at, duration, resolution, aspect_ratio)
       VALUES (@id, @taskId, @prompt, @modelId, @modelName, @videoUrl, @thumbnailPath, @status, @createdAt, @duration, @resolution, @aspectRatio)`,
    ).run({
      id: gen.id,
      taskId: gen.taskId,
      prompt: gen.prompt,
      modelId: gen.modelId,
      modelName: gen.modelName,
      videoUrl: gen.videoUrl ?? null,
      thumbnailPath: gen.thumbnailPath ?? null,
      status: gen.status,
      createdAt: gen.createdAt,
      duration: gen.duration ?? null,
      resolution: gen.resolution ?? null,
      aspectRatio: gen.aspectRatio ?? null,
    })

    return gen
  }

  list(filter?: { modelId?: string; dateFrom?: number; dateTo?: number }, page = 1, pageSize = 50): Generation[] {
    const db = databaseConnection.getDb()
    let sql = 'SELECT * FROM generations WHERE 1=1'
    const params: Record<string, unknown> = {}

    if (filter?.modelId) {
      sql += ' AND model_id = @modelId'
      params.modelId = filter.modelId
    }
    if (filter?.dateFrom) {
      sql += ' AND created_at >= @dateFrom'
      params.dateFrom = filter.dateFrom
    }
    if (filter?.dateTo) {
      sql += ' AND created_at <= @dateTo'
      params.dateTo = filter.dateTo
    }

    const offset = Math.max(0, (page - 1)) * Math.max(1, pageSize)
    sql += ` ORDER BY created_at DESC LIMIT ${Math.max(1, pageSize)} OFFSET ${offset}`

    const rows = db.prepare(sql).all(params) as Record<string, unknown>[]
    return rows.map((r) => this.rowToGeneration(r))
  }

  getById(id: string): Generation | null {
    const db = databaseConnection.getDb()
    const row = db.prepare('SELECT * FROM generations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return this.rowToGeneration(row)
  }

  private rowToGeneration(row: Record<string, unknown>): Generation {
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      prompt: row.prompt as string,
      modelId: row.model_id as string,
      modelName: row.model_name as string,
      videoUrl: row.video_url as string | undefined,
      thumbnailPath: row.thumbnail_path as string | undefined,
      status: row.status as string,
      createdAt: row.created_at as number,
      duration: row.duration as number | undefined,
      resolution: row.resolution as string | undefined,
      aspectRatio: row.aspect_ratio as string | undefined,
    }
  }
}

export const historyStore = new HistoryStore()
