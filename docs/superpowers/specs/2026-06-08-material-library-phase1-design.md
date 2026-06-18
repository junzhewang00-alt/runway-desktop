# 素材库 Phase 1 — 本地素材管理

日期：2026-06-08
状态：待实现

## 概述

为 Runway Desktop 新增本地素材库功能，支持导入/管理图片素材，为后续 Runway 参考图上传做准备。

Phase 1 范围：素材库本地管理（导入、浏览、删除、任务关联数据层）。
Phase 2（后续）：CDP 上传参考图到 Runway（待诊断确认 DOM 结构后实现）。

## 数据模型

### 素材表

```sql
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
```

- `file_path` 是素材目录中的绝对路径（`<userData>/materials/<uuid>.<ext>`）
- `width` / `height` 第一阶段预留，不读取实际尺寸

### 任务-素材关联表

```sql
CREATE TABLE IF NOT EXISTS task_materials (
  task_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  PRIMARY KEY (task_id, material_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);
```

**重要**: 外键 CASCADE 依赖 `PRAGMA foreign_keys = ON`。现有 `connection.ts` 只设置了 `journal_mode = WAL`，未开启外键。迁移时必须在 `migrate()` 中添加 `PRAGMA foreign_keys = ON`。

## 类型定义

`src/types/materials.ts`:

- `Material` 接口：id, fileName, filePath, mimeType, fileSize, width?, height?, createdAt
- `CreateMaterialParams` 接口：fileName, filePath, mimeType, fileSize, width?, height?
- `IMaterialService` 接口：import, list, delete, getPath, linkTask, unlinkTask, getByTaskId

## 组件架构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/types/materials.ts` | Material 类型 + IMaterialService 接口 |
| `src/database/material.store.ts` | SQLite CRUD（单例），含 task_materials 关联方法 |
| `src/services/material.service.ts` | 业务逻辑：文件复制、删除、素材导入 |
| `src/ui/MaterialPanel.tsx` | 素材网格面板 UI |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/database/connection.ts` | migrate() 新增 materials + task_materials 表 + PRAGMA foreign_keys = ON |
| `src/main/index.ts` | 注册 material-file: 协议（ready 之前）+ 4个 IPC handler |
| `src/preload/index.ts` | api 对象新增 material 命名空间 |
| `src/renderer/env.d.ts` | ElectronAPI 类型新增 material（自动推断） |
| `src/renderer/App.tsx` | LeftTab 类型新增 'materials'，Tab 栏新增"素材"按钮 |

## Store & Service 层

### MaterialStore

方法：
- `insert(params: CreateMaterialParams) → Material` — uuid v4 生成 id
- `list() → Material[]` — ORDER BY created_at DESC
- `getById(id: string) → Material | null`
- `deleteById(id: string) → void`
- `linkTask(taskId, materialId) → void`
- `unlinkTask(taskId, materialId) → void`
- `getByTaskId(taskId) → Material[]`

### MaterialService

- `import(paths: string[]) → Material[]`：确保 `<userData>/materials/` 目录存在 → 逐个复制文件、写入元数据

  **使用 `fs.promises.copyFile`（异步）而非 `copyFileSync`**，避免批量导入时阻塞主进程。
  **MIME type 通过文件扩展名映射**（.png→image/png, .jpg→image/jpeg, .jpeg→image/jpeg, .webp→image/webp），不引入 `file-type` 等额外依赖。

- `delete(id: string) → void`：先删数据库记录，再删磁盘文件（最佳努力）。磁盘文件丢失不阻塞 DB 删除。
- `list()` / `getPath(id)`：代理 store 方法
- 宽高读取暂不实现，字段预留

## IPC & 自定义协议

### 自定义协议 — 必须在 `app.whenReady()` 之前注册

现有代码所有逻辑都在 `app.whenReady().then(...)` 内，**协议注册必须移到外面**：

```ts
// ✅ 在 app.whenReady() 之前注册
import { pathToFileURL } from 'url'

protocol.handle('material-file', (request) => {
  const id = new URL(request.url).hostname
  const mat = materialStore.getById(id)
  if (!mat) return new Response('Not found', { status: 404 })

  // pathToFileURL 正确处理 Windows 反斜杠 → file:///C:/...
  return net.fetch(pathToFileURL(mat.filePath).href)
})

app.whenReady().then(() => {
  createWindow()
  // ...
})
```

不可用简单的字符串拼接 `'file://' + filePath`，Windows 路径含反斜杠会导致 URL 解析失败。

渲染进程直接使用 `<img src="material-file://<id>/" />` 显示图片。

### IPC 通道

| 通道 | 参数 | 返回 | 注意 |
|------|------|------|------|
| material:openDialog | 无 | string[] | 需要传 `mainWindow` 作为父窗口，判空保护 |
| material:import | { paths: string[] } | Material[] | 异步处理，超时 30s（批量导入可能较慢） |
| material:list | 无 | Material[] | 无 |
| material:delete | { id: string } | void | 先删 DB 再删文件 |

openDialog 实现细节：

```ts
ipcMain.handle('material:openDialog', withIpcTimeout(async () => {
  if (!mainWindow) return []  // 窗口关闭时返回空
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  return result.canceled ? [] : result.filePaths
}))
```

## UI 设计

### MaterialPanel

- 顶部：导入按钮
- 主区域：网格布局（flex wrap, gap: 8px），每格 ~100px 正方形缩略图
- 悬停显示删除按钮（absolute 右上角，opacity 0→1）
- 点击选中（蓝色边框高亮），Ctrl/Cmd+Click 多选
- 支持拖拽图片文件到面板区域导入（HTML5 drop，需要 `e.preventDefault()` 在 dragover 事件）
- 空状态：居中提示文字
- 所有图片通过 `material-file://` 协议加载
- 注意：网格中直接显示原图，大量高分辨率图片时可能占内存。Phase 1 可接受，后续可优化为缩略图缓存。

### App.tsx 集成

- LeftTab 类型扩展为 `'tasks' | 'history' | 'materials'`
- Tab 栏新增"素材"按钮
- 内容区新增 MaterialPanel 分支，包裹 ErrorBoundary

## 任务-素材关联

Phase 1 只建立数据层（task_materials 表 + store 方法），UI 层面的任务-素材关联（TaskPanel 中选择素材）留到 Phase 2 和 Runway 上传一起实现。

## 错误处理

| 场景 | 处理 |
|------|------|
| 导入时文件不存在 | try-catch per file，跳过该文件，继续处理其余 |
| 重复导入 | 每次生成新 UUID，不检测重复（简单可靠） |
| 删除时磁盘文件已不存在 | catch 忽略，继续删库记录 |
| DB 删除成功但文件删除失败 | 静默记录日志（孤儿文件不阻塞流程） |
| 素材目录不存在 | `mkdirSync({ recursive: true })` 自动创建 |
| 批量导入阻塞主进程 | 使用 `fs.promises.copyFile` 异步，配合 `Promise.all` 或顺序处理 |
| material-file 无效 id | 返回 404 Response |
| IPC 超时 | withIpcTimeout 10s |
| openDialog 时窗口已关闭 | `mainWindow` 判空，返回 `[]` |
| 拖拽非图片文件 | 前端过滤 MIME/扩展名，静默忽略 |
| 素材被任务引用时删除 | ON DELETE CASCADE（需 foreign_keys = ON） |
| 协议未生效（注册时机错误） | 必须在 `app.whenReady()` 之前注册 `protocol.handle` |

## 数据库迁移 — 必须开启外键

`src/database/connection.ts` 的 `migrate()` 方法中需要：

```ts
// 开启外键约束（task_materials 的 CASCADE 依赖此设置）
this.db.pragma('foreign_keys = ON')
```

## 实现顺序

1. `src/types/materials.ts` — 类型定义
2. `src/database/connection.ts` — 数据库迁移 + PRAGMA foreign_keys = ON
3. `src/database/material.store.ts` — Store 层
4. `src/services/material.service.ts` — Service 层（异步文件操作）
5. `src/main/index.ts` — **协议注册在 ready 之前** + IPC handler
6. `src/preload/index.ts` — Preload 暴露
7. `src/ui/MaterialPanel.tsx` — UI 面板
8. `src/renderer/App.tsx` — Tab 集成

每步完成后可独立验证（TypeScript 编译通过 + 功能测试）。

## 不包含

- 图片宽高自动检测（预留字段）
- 缩略图生成（Phase 1 直接通过协议加载原图显示，后续可优化）
- Runway 参考图上传（Phase 2，待 DOM 诊断）
- 任务创建时的素材选择 UI（Phase 2）
