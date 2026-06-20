const uuidv4 = (): string => crypto.randomUUID()
import { databaseConnection } from './connection'
import type { Material, CreateMaterialParams } from '../types/materials'

export class MaterialStore {
  insert(params: CreateMaterialParams): Material {
    const db = databaseConnection.getDb()
    const material: Material = {
      id: uuidv4(),
      fileName: params.fileName,
      filePath: params.filePath,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      width: params.width,
      height: params.height,
      createdAt: Date.now(),
    }

    db.prepare(
      `INSERT INTO materials (id, file_name, file_path, mime_type, file_size, width, height, created_at)
       VALUES (@id, @fileName, @filePath, @mimeType, @fileSize, @width, @height, @createdAt)`,
    ).run({
      id: material.id,
      fileName: material.fileName,
      filePath: material.filePath,
      mimeType: material.mimeType,
      fileSize: material.fileSize,
      width: material.width ?? null,
      height: material.height ?? null,
      createdAt: material.createdAt,
    })

    return material
  }

  list(): Material[] {
    const db = databaseConnection.getDb()
    const rows = db
      .prepare('SELECT * FROM materials ORDER BY created_at DESC')
      .all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToMaterial(r))
  }

  getById(id: string): Material | null {
    const db = databaseConnection.getDb()
    const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return this.rowToMaterial(row)
  }

  deleteById(id: string): void {
    const db = databaseConnection.getDb()
    db.prepare('DELETE FROM materials WHERE id = ?').run(id)
  }

  linkTask(taskId: string, materialId: string): void {
    const db = databaseConnection.getDb()
    db.prepare(
      'INSERT OR IGNORE INTO task_materials (task_id, material_id) VALUES (@taskId, @materialId)',
    ).run({ taskId, materialId })
  }

  unlinkTask(taskId: string, materialId: string): void {
    const db = databaseConnection.getDb()
    db.prepare(
      'DELETE FROM task_materials WHERE task_id = @taskId AND material_id = @materialId',
    ).run({ taskId, materialId })
  }

  getByTaskId(taskId: string): Material[] {
    const db = databaseConnection.getDb()
    const rows = db
      .prepare(
        `SELECT m.* FROM materials m
         INNER JOIN task_materials tm ON m.id = tm.material_id
         WHERE tm.task_id = ?
         ORDER BY tm.rowid ASC`,
      )
      .all(taskId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToMaterial(r))
  }

  private rowToMaterial(row: Record<string, unknown>): Material {
    return {
      id: row.id as string,
      fileName: row.file_name as string,
      filePath: row.file_path as string,
      mimeType: row.mime_type as string,
      fileSize: row.file_size as number,
      width: row.width as number | undefined,
      height: row.height as number | undefined,
      createdAt: row.created_at as number,
    }
  }
}

export const materialStore = new MaterialStore()
