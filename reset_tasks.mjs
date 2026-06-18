import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'

const dbPath = join(homedir(), 'AppData', 'Roaming', 'runway-desktop', 'runway-desktop.db')
const db = new Database(dbPath)

const result = db.prepare("UPDATE tasks SET status='pending', error=NULL, updated_at=@now WHERE status='running'").run({ now: Date.now() })
console.log('重置 running → pending:', result.changes, 'rows')

const tasks = db.prepare('SELECT id,status,prompt FROM tasks ORDER BY created_at').all()
tasks.forEach(t => console.log('  [', t.status, ']', t.id.slice(0,8), '|', t.prompt))
db.close()
