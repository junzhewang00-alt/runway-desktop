# 素材库 Phase 1 — 本地素材管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Runway Desktop 新增素材库面板，支持导入/浏览/删除本地图片素材

**Architecture:** 遵循现有分层模式 — types → database store → service → IPC handlers → preload → React UI。图片通过 `material-file://` 自定义协议加载，素材文件存储在 `<userData>/materials/` 目录

**Tech Stack:** Electron 33, React 18, TypeScript 5.6, better-sqlite3 11, uuid 10

---

### Task 1: 类型定义 `src/types/materials.ts`

**Files:**
- Create: `src/types/materials.ts`

- [ ] **Step 1: 创建类型文件**

```ts
export interface Material {
  id: string
  fileName: string
  filePath: string
  mimeType: string
  fileSize: number
  width?: number
  height?: number
  createdAt: number
}

export interface CreateMaterialParams {
  fileName: string
  filePath: string
  mimeType: string
  fileSize: number
  width?: number
  height?: number
}

export interface IMaterialService {
  import(paths: string[]): Promise<Material[]>
  list(): Material[]
  delete(id: string): void
  getPath(id: string): string | null
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 编译通过（仅新文件，无引用方，无 ERROR）

- [ ] **Step 3: 提交**

```bash
git add src/types/materials.ts
git commit -m "feat: add Material types"
```

---

### Task 2: 数据库迁移 `src/database/connection.ts`

**Files:**
- Modify: `src/database/connection.ts`

- [ ] **Step 1: 在 `migrate()` 方法开头添加 PRAGMA，末尾添加新表**

修改 `src/database/connection.ts` 的 `migrate()` 方法：

```ts
private migrate(): void {
  // 开启外键约束（task_materials 的 CASCADE 依赖此设置）
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
  `)

  // 对旧数据库添加新列（保持不变）
  for (const col of [
    { name: 'priority', def: "TEXT NOT NULL DEFAULT 'medium'" },
    { name: 'note', def: "TEXT NOT NULL DEFAULT ''" },
    { name: 'retry_count', def: 'INTEGER NOT NULL DEFAULT 0' },
  ]) {
    try {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN ${col.name} ${col.def}`)
    } catch {
      /* 列已存在，忽略 */
    }
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR

- [ ] **Step 3: 提交**

```bash
git add src/database/connection.ts
git commit -m "feat: add materials + task_materials tables with FK pragma"
```

---

### Task 3: Store 层 `src/database/material.store.ts`

**Files:**
- Create: `src/database/material.store.ts`

- [ ] **Step 1: 创建 MaterialStore**

仿照 `src/database/history.store.ts` 的单例模式：

```ts
import { v4 as uuidv4 } from 'uuid'
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
         ORDER BY m.created_at DESC`,
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
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR

- [ ] **Step 3: 提交**

```bash
git add src/database/material.store.ts
git commit -m "feat: add MaterialStore with CRUD + task association methods"
```

---

### Task 4: Service 层 `src/services/material.service.ts`

**Files:**
- Create: `src/services/material.service.ts`

- [ ] **Step 1: 创建 MaterialService**

```ts
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { materialStore } from '../database/material.store'
import type { Material, IMaterialService } from '../types/materials'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export class MaterialService implements IMaterialService {
  async import(paths: string[]): Promise<Material[]> {
    const materialsDir = path.join(app.getPath('userData'), 'materials')
    fs.mkdirSync(materialsDir, { recursive: true })

    const results: Material[] = []

    for (const srcPath of paths) {
      try {
        const stat = fs.statSync(srcPath)
        const ext = path.extname(srcPath).toLowerCase()
        const mimeType = MIME_MAP[ext] || 'application/octet-stream'
        const destName = `${crypto.randomUUID()}` + ext
        const destPath = path.join(materialsDir, destName)

        await fs.promises.copyFile(srcPath, destPath)

        const material = materialStore.insert({
          fileName: path.basename(srcPath),
          filePath: destPath,
          mimeType,
          fileSize: stat.size,
        })

        results.push(material)
      } catch (err) {
        // 单个文件失败不阻塞其余导入
        continue
      }
    }

    return results
  }

  list(): Material[] {
    return materialStore.list()
  }

  delete(id: string): void {
    const mat = materialStore.getById(id)
    materialStore.deleteById(id)

    if (mat) {
      try {
        fs.unlinkSync(mat.filePath)
      } catch {
        // 磁盘文件不存在，忽略
      }
    }
  }

  getPath(id: string): string | null {
    const mat = materialStore.getById(id)
    return mat?.filePath ?? null
  }
}

export const materialService = new MaterialService()
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR

- [ ] **Step 3: 提交**

```bash
git add src/services/material.service.ts
git commit -m "feat: add MaterialService with async file import"
```

---

### Task 5: IPC 协议 + Handler `src/main/index.ts`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 在文件顶部添加新 import**

在现有 import 块末尾添加：

```ts
import { dialog, net, protocol } from 'electron'
import { materialStore } from '../database/material.store'
import { materialService } from '../services/material.service'
import { pathToFileURL } from 'url'
```

完整 import 块变为：

```ts
import { app, BrowserWindow, ipcMain, dialog, net, protocol } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { browserManager, BrowserManager } from '../browser/browser.manager'
import { sessionManager } from '../browser/session.manager'
import { taskQueue } from '../queue/task.queue'
import { generationService } from '../services/generation.service'
import { runwayAdapter } from '../adapters/runway.adapter'
import { logger } from '../logs/logger'
import { modelService } from '../services/model.service'
import { historyStore } from '../database/history.store'
import { materialStore } from '../database/material.store'
import { materialService } from '../services/material.service'
import type { TaskStatus } from '../types/tasks'
```

- [ ] **Step 2: 在 `app.whenReady()` 之前注册自定义协议**

在 `app.whenReady().then(...)` 行**之前**插入：

```ts
// 素材库自定义协议 — 必须在 app.whenReady() 之前注册
protocol.handle('material-file', (request) => {
  const id = new URL(request.url).hostname
  const mat = materialStore.getById(id)
  if (!mat) return new Response('Not found', { status: 404 })
  return net.fetch(pathToFileURL(mat.filePath).href)
})
```

- [ ] **Step 3: 在 IPC Handlers 区域末尾添加 4 个素材 handler**

在 `// Debug - 诊断` handler **之前**、`// Sprint 6 - Logger export` handler **之后**插入：

```ts
// Material — 素材库
ipcMain.handle('material:openDialog', withIpcTimeout(async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  return result.canceled ? [] : result.filePaths
}))

ipcMain.handle('material:import', withIpcTimeout(async (_event, { paths }: { paths: string[] }) => {
  return materialService.import(paths)
}, 30_000))

ipcMain.handle('material:list', withIpcTimeout(() => {
  return materialService.list()
}))

ipcMain.handle('material:delete', withIpcTimeout((_event, { id }: { id: string }) => {
  materialService.delete(id)
}))
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR

- [ ] **Step 5: 检查关键位置**

确认修改后的文件结构：
1. `protocol.handle('material-file', ...)` 在 `app.whenReady()` 行**之前**
2. 素材 IPC handler 在 `// ──── IPC Handlers ────` 区域末尾
3. 所有 handler 用 `withIpcTimeout` 包裹
4. `material:import` 超时参数为 `30_000`

- [ ] **Step 6: 提交**

```bash
git add src/main/index.ts
git commit -m "feat: add material-file protocol + material IPC handlers"
```

---

### Task 6: Preload 暴露 `src/preload/index.ts`

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 在 `api` 对象中添加 `material` 命名空间**

在 `debug` 对象后面（闭合 `}` 之前）添加逗号和 material：

```ts
const api = {
  // ... 现有所有属性保持不变 ...

  // Debug
  debug: {
    diagnose: () => ipcRenderer.invoke('debug:diagnose'),
  },

  // Material
  material: {
    openDialog: () => ipcRenderer.invoke('material:openDialog'),
    import: (paths: string[]) => ipcRenderer.invoke('material:import', { paths }),
    list: () => ipcRenderer.invoke('material:list'),
    delete: (id: string) => ipcRenderer.invoke('material:delete', { id }),
  },
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR。`env.d.ts` 从 `typeof api` 自动推断 `ElectronAPI.material`，无需手动修改。

- [ ] **Step 3: 提交**

```bash
git add src/preload/index.ts
git commit -m "feat: expose material API via preload"
```

---

### Task 7: 素材面板 UI `src/ui/MaterialPanel.tsx`

**Files:**
- Create: `src/ui/MaterialPanel.tsx`

- [ ] **Step 1: 创建 MaterialPanel 组件**

```tsx
import React, { useEffect, useState } from 'react'
import type { Material } from '../types/materials'

const MaterialPanel: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)

  const loadMaterials = () => {
    window.electronAPI.material.list().then(setMaterials)
  }

  useEffect(() => {
    loadMaterials()
  }, [])

  const handleImport = async () => {
    const paths = await window.electronAPI.material.openDialog()
    if (paths.length > 0) {
      await window.electronAPI.material.import(paths)
      loadMaterials()
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await window.electronAPI.material.delete(id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    loadMaterials()
  }

  const handleSelect = (id: string, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
      } else {
        next.clear()
        next.add(id)
      }
      return next
    })
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']

    // Electron sandbox:false 时 File 对象有 .path 属性
    const paths = files
      .filter((f) => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase()
        return imageExtensions.includes(ext)
      })
      .map((f) => (f as any).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    if (paths.length > 0) {
      await window.electronAPI.material.import(paths)
      loadMaterials()
    }
  }

  return (
    <div
      style={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div style={styles.toolbar}>
        <button onClick={handleImport} style={styles.importBtn}>
          导入图片
        </button>
        {selectedIds.size > 0 && (
          <span style={styles.selectedCount}>
            已选 {selectedIds.size} 张
          </span>
        )}
      </div>

      <div
        style={{
          ...styles.grid,
          borderColor: dragOver ? '#0078d4' : 'transparent',
        }}
      >
        {materials.length === 0 && (
          <p style={styles.empty}>
            暂无素材，拖拽图片到此处或点击上方按钮导入
          </p>
        )}

        {materials.map((mat) => {
          const isSelected = selectedIds.has(mat.id)
          return (
            <div
              key={mat.id}
              onClick={(e) => handleSelect(mat.id, e)}
              title={mat.fileName}
              style={{
                ...styles.card,
                borderColor: isSelected ? '#0078d4' : '#e0e0e0',
              }}
            >
              <img
                src={`material-file://${mat.id}/`}
                alt={mat.fileName}
                style={styles.thumbnail}
              />
              <button
                onClick={(e) => handleDelete(mat.id, e)}
                style={styles.deleteBtn}
              >
                x
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#f5f5f5',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#e8e8e8',
    borderBottom: '1px solid #ddd',
  },
  importBtn: {
    padding: '6px 14px',
    background: '#0078d4',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  },
  selectedCount: {
    fontSize: 11,
    color: '#666',
  },
  grid: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '8px',
    alignContent: 'flex-start',
    border: '2px solid transparent',
    transition: 'border-color 0.2s',
  },
  empty: {
    width: '100%',
    textAlign: 'center',
    color: '#999',
    fontSize: 13,
    padding: 40,
  },
  card: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: 4,
    border: '2px solid',
    overflow: 'hidden',
    cursor: 'pointer',
    background: '#fff',
    flexShrink: 0,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  deleteBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    background: 'rgba(217, 83, 79, 0.85)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '18px',
    textAlign: 'center',
    padding: 0,
    opacity: 0,
    transition: 'opacity 0.15s',
  },
}

export default MaterialPanel
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR

- [ ] **Step 3: 提交**

```bash
git add src/ui/MaterialPanel.tsx
git commit -m "feat: add MaterialPanel with grid, drag-drop, and select"
```

---

### Task 8: App.tsx 集成 `src/renderer/App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 修改 LeftTab 类型和导入**

修改第 9 行的 `LeftTab` 类型：

```tsx
type LeftTab = 'tasks' | 'history' | 'materials'
```

在文件顶部导入区添加 MaterialPanel 导入：

```tsx
import MaterialPanel from '../ui/MaterialPanel'
```

- [ ] **Step 2: 在 Tab 栏添加"素材"按钮**

在"历史"按钮后添加：

```tsx
<button
  onClick={() => setLeftTab('materials')}
  style={{
    ...styles.tab,
    ...(leftTab === 'materials' ? styles.tabActive : {}),
  }}
>
  素材
</button>
```

- [ ] **Step 3: 在内容区域添加 MaterialPanel 分支**

修改左侧面板内容区域的三元表达式为条件链。将原：

```tsx
{leftTab === 'tasks' ? (
  <ErrorBoundary panelName="Task Panel">
    <TaskPanel />
  </ErrorBoundary>
) : (
  <ErrorBoundary panelName="History Panel">
    <HistoryPanel />
  </ErrorBoundary>
)}
```

改为：

```tsx
{leftTab === 'tasks' && (
  <ErrorBoundary panelName="Task Panel">
    <TaskPanel />
  </ErrorBoundary>
)}
{leftTab === 'history' && (
  <ErrorBoundary panelName="History Panel">
    <HistoryPanel />
  </ErrorBoundary>
)}
{leftTab === 'materials' && (
  <ErrorBoundary panelName="Material Panel">
    <MaterialPanel />
  </ErrorBoundary>
)}
```

这样三个分支互相独立，逻辑更清晰。

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 无 ERROR

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx
git commit -m "feat: add materials tab to sidebar"
```

---

### 最终验证

所有 Task 完成后运行：

```bash
npx tsc --noEmit --project tsconfig.json
```

Expected: 零 ERROR，零 WARNING。

然后启动应用验证：

```bash
npm run dev
```

检查清单：
- [ ] 左侧面板出现"素材"Tab
- [ ] 点击"导入图片"弹出文件选择器，筛选 .png/.jpg/.jpeg/.webp
- [ ] 选中图片后出现在网格中，显示缩略图
- [ ] 悬停卡片显示删除按钮
- [ ] 点击删除按钮，素材消失
- [ ] 点击卡片，蓝色边框高亮选中
- [ ] 刷新/重启应用后素材仍在
- [ ] 切换到其他 Tab 再切回来，素材列表保持不变
