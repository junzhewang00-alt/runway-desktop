import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'

export interface IDatabaseConnection {
  getDb(): Database.Database
  close(): void
}

export class DatabaseConnection implements IDatabaseConnection {
  private _db: Database.Database | null = null

  private get db(): Database.Database {
    if (!this._db) {
      const dbPath = path.join(app.getPath('userData'), 'runway-desktop.db')
      this._db = new Database(dbPath)
      this._db.pragma('journal_mode = WAL')
      this.migrate()
    }
    return this._db
  }

  private migrate(): void {
    this.db.pragma('foreign_keys = ON')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'medium',
        note TEXT NOT NULL DEFAULT '',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        result TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        video_url TEXT,
        thumbnail_path TEXT,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_materials (
        task_id TEXT NOT NULL,
        material_id TEXT NOT NULL,
        PRIMARY KEY (task_id, material_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_generations_task ON generations(task_id);
      CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(created_at);
      CREATE INDEX IF NOT EXISTS idx_generations_model_created ON generations(model_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_materials_task ON task_materials(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_materials_material ON task_materials(material_id);
    `)

    // 使用 PRAGMA table_info 检查列是否存在，幂等安全
    const addColumnIfMissing = (table: string, colName: string, colDef: string) => {
      const existing = this.db
        .prepare(`PRAGMA table_info(${table})`)
        .all() as { name: string }[]
      if (!existing.some((c) => c.name === colName)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`)
      }
    }

    for (const col of [
      { name: 'priority', def: "TEXT NOT NULL DEFAULT 'medium'" },
      { name: 'note', def: "TEXT NOT NULL DEFAULT ''" },
      { name: 'retry_count', def: 'INTEGER NOT NULL DEFAULT 0' },
      { name: 'duration', def: 'INTEGER' },
      { name: 'resolution', def: 'TEXT' },
      { name: 'aspect_ratio', def: 'TEXT' },
    ]) {
      addColumnIfMissing('tasks', col.name, col.def)
    }

    for (const col of [
      { name: 'duration', def: 'INTEGER' },
      { name: 'resolution', def: 'TEXT' },
      { name: 'aspect_ratio', def: 'TEXT' },
    ]) {
      addColumnIfMissing('generations', col.name, col.def)
    }
  }

  getDb(): Database.Database {
    return this.db
  }

  close(): void {
    if (this._db) {
      this._db.close()
      this._db = null
    }
  }
}

export const databaseConnection = new DatabaseConnection()
