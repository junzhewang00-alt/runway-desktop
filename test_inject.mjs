// 注入 3 个测试任务到队列
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'

const dbPath = join(homedir(), 'AppData', 'Roaming', 'runway-desktop', 'runway-desktop.db')
console.log('DB路径:', dbPath)
const db = new Database(dbPath)

// 清理旧任务（先删子表再删主表，避免 FK 约束）
db.exec('DELETE FROM generations')
db.exec('DELETE FROM task_materials')
db.exec('DELETE FROM tasks')

// 注入 3 个测试任务
const now = Date.now()
const tasks = [
  { prompt: '自动测试1-大海日落', model: 'wan-2.6' },
  { prompt: '自动测试2-城市夜景', model: 'wan-2.6' },
  { prompt: '自动测试3-森林溪流', model: 'wan-2.6' },
]

const insert = db.prepare(
  `INSERT INTO tasks (id, prompt, model_id, status, priority, note, retry_count, created_at, updated_at)
   VALUES (@id, @prompt, @model_id, 'pending', 'high', @note, 0, @created_at, @updated_at)`
)

for (let i = 0; i < tasks.length; i++) {
  const t = tasks[i]
  insert.run({
    id: randomUUID(),
    prompt: t.prompt,
    model_id: t.model,
    note: `自动注入测试 #${i + 1}`,
    created_at: now + i * 100,
    updated_at: now + i * 100,
  })
  console.log('  ✓', t.prompt)
}

const newCount = db.prepare('SELECT count(*) as cnt FROM tasks').get()
console.log('注入后任务数:', newCount.cnt)
console.log('DONE — 3 个测试任务就绪')
db.close()
