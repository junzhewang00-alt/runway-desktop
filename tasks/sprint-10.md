# Sprint 10 — 错误处理与容错

## TASK-010: 全局错误处理 + 重试机制

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 9 完成

### 描述

当前代码缺少系统性的错误处理：
- React 组件崩溃会导致白屏（`App.tsx` 三面板无任何保护）
- Adapter 操作失败没有重试（`runway.adapter.ts` 直接抛异常）
- 失败任务只能删除，无法重试（`TaskPanel.tsx` 无 Retry 按钮）
- BrowserView crash 无恢复机制（`browser.manager.ts` 无 crash 监听）

---

## 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/ui/ErrorBoundary.tsx` | **新建** | React 错误边界组件 |
| `src/renderer/App.tsx` | 修改 | 三个面板包裹 ErrorBoundary |
| `src/adapters/runway.adapter.ts` | 修改 | 添加 withRetry，包装所有公开方法 |
| `src/types/tasks.ts` | 修改 | Task 接口添加 retryCount |
| `src/database/connection.ts` | 修改 | migrate() 添加 retry_count 列 |
| `src/queue/task.queue.ts` | 修改 | rowToTask 添加 retryCount，新增 retryTask() |
| `src/browser/browser.manager.ts` | 修改 | 添加 crash/destroyed 监听 + 自动重建 |
| `src/main/index.ts` | 修改 | crash 恢复后重新注入 Adapter；IPC 超时包装；新增 queue:retry handler |
| `src/preload/index.ts` | 修改 | 暴露 queue:retry API |
| `src/ui/TaskPanel.tsx` | 修改 | 失败任务显示 Retry 按钮 |
| `src/services/generation.service.ts` | 修改 | 重试时递增 retryCount |

---

## 详细实现

### 1. ErrorBoundary (`src/ui/ErrorBoundary.tsx` 新建)

```tsx
import React, { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  panelName: string  // 用于错误信息中标识是哪个面板
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '20px',
          color: '#d9534f',
          background: '#fff5f5',
          textAlign: 'center',
        }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {this.props.panelName} Crashed
          </p>
          <p style={{ fontSize: 12, color: '#999', marginBottom: 16, maxWidth: 250 }}>
            {this.state.error?.message}
          </p>
          <button onClick={this.handleRetry} style={{
            padding: '6px 16px',
            background: '#0078d4',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

### 2. App.tsx 包裹 ErrorBoundary

在 `src/renderer/App.tsx` 中，将三个面板分别包裹：

```tsx
// 修改前：
<TaskPanel />

// 修改后：
<ErrorBoundary panelName="Task Panel">
  <TaskPanel />
</ErrorBoundary>
```

同理：`BrowserPanel` 包裹 `panelName="Browser Panel"`，`LogPanel` 包裹 `panelName="Log Panel"`。

### 3. RunwayAdapter 添加 withRetry

在 `src/adapters/runway.adapter.ts` 中：

```typescript
// 新增常量
const MAX_RETRIES = 3

// 新增工具方法
private async withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === maxRetries) throw err
      const delay = Math.pow(2, i) * 1000
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}
```

然后修改每个公开方法，将内部逻辑用 `withRetry` 包装。例如 `selectModel`：

```typescript
async selectModel(modelId: string): Promise<void> {
  await this.withRetry(async () => {
    // 原有逻辑...
  }, `selectModel(${modelId})`)
}
```

每个方法单独包装，保证 index 独立（不共享重试计数器）。

### 4. Task 数据模型扩展

**`src/types/tasks.ts`**：

```typescript
export interface Task {
  id: string
  prompt: string
  modelId: string
  status: TaskStatus
  priority: TaskPriority    // Sprint 12 保留字段，当前默认 'medium'
  note: string              // Sprint 12 保留字段，当前默认 ''
  retryCount: number        // 新增
  createdAt: number
  updatedAt: number
  result?: string
  error?: string
}

export type TaskPriority = 'high' | 'medium' | 'low'  // Sprint 12 用到
```

**`src/database/connection.ts`** 的 `migrate()` 方法：

```typescript
// 添加列（使用 IF NOT EXISTS 方式的 ALTER TABLE）
// SQLite 不支持 IF NOT EXISTS for ALTER TABLE，用 try-catch
try {
  db.exec('ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0')
} catch { /* 列已存在，忽略 */ }
```

### 5. TaskQueue 添加 retryTask

**`src/queue/task.queue.ts`**：

```typescript
// 新增方法
retryTask(id: string): void {
  const task = this.getById(id)
  if (!task) throw new Error(`Task not found: ${id}`)
  if (task.status !== 'failed') throw new Error(`Can only retry failed tasks`)
  
  const db = databaseConnection.getDb()
  db.prepare(
    `UPDATE tasks SET status = 'pending', error = NULL, retry_count = retry_count + 1, updated_at = @updatedAt WHERE id = @id`
  ).run({ id, updatedAt: Date.now() })
  // worker 会自动消费 reset 为 pending 的任务
}
```

**`rowToTask` 方法** 添加 `retryCount` 映射：

```typescript
retryCount: (row.retry_count as number) ?? 0,
```

**`create` 方法** 插入时添加 `retry_count` 列：

```typescript
// INSERT 语句添加 retry_count 字段，默认 0
```

### 6. BrowserManager 添加 crash 恢复

**`src/browser/browser.manager.ts`**：

在 `attachTo` 方法中，BrowserView 创建后立即注册 crash 事件：

```typescript
// 在 this.browserView = new BrowserView({...}) 之后
this.browserView.webContents.on('crashed', (event, killed) => {
  console.error(`BrowserView crashed (killed=${killed})`)
  this.rebuildBrowserView(hostWindow, initialBounds)
})

this.browserView.webContents.on('destroyed', () => {
  // 非主动 destroy 导致的 destroyed（crash 导致）
  if (this.browserView) {
    this.rebuildBrowserView(hostWindow, initialBounds)
  }
})
```

新增私有方法 `rebuildBrowserView`：

```typescript
private rebuildBrowserView(hostWindow: BrowserWindow, bounds?: { x: number; y: number; width: number; height: number }): void {
  // 清理旧引用
  this.browserView = null
  hostWindow.setBrowserView(null as any)  // removeBrowserView 只接收 BrowserView 实例，这里不需要
  
  // 重建
  this.attachTo(hostWindow, bounds)
  this.loadURL(BrowserManager.RUNWAY_URL)
  
  // 通知外部：BrowserView 已重建（供 main/index.ts 重新注入 Adapter）
  if (this.onRebuild) {
    this.onRebuild(this.browserView!)
  }
}
```

添加回调属性：

```typescript
private onRebuild: ((bv: BrowserView) => void) | null = null

setOnRebuild(callback: (bv: BrowserView) => void): void {
  this.onRebuild = callback
}
```

### 7. main/index.ts 修改

#### 7.1 IPC 超时包装

为每个 handler 添加 10s 超时：

```typescript
function withIpcTimeout<T>(
  handler: (...args: any[]) => Promise<T>,
  timeoutMs = 10_000,
): (...args: any[]) => Promise<T> {
  return (...args: any[]) => {
    return Promise.race([
      handler(...args),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('IPC timeout')), timeoutMs),
      ),
    ])
  }
}

// 对所有 handler 包装：
ipcMain.handle('queue:create', withIpcTimeout((_event, params) => {
  return taskQueue.create(params)
}))
```

#### 7.2 BrowserView crash 恢复后重新注入 Adapter

```typescript
browserManager.setOnRebuild((newBv) => {
  logger.warn('Browser', 'BrowserView rebuilt after crash')
  runwayAdapter.setBrowserView(newBv)
})
```

#### 7.3 queue:retry handler

```typescript
ipcMain.handle('queue:retry', (_event, id: string) => {
  taskQueue.retryTask(id)
})
```

### 8. preload/index.ts 修改

在 `api` 对象的 `queue` 中添加：

```typescript
queue: {
  create: (params) => ipcRenderer.invoke('queue:create', params),
  list: (status?) => ipcRenderer.invoke('queue:list', status),
  updateStatus: (id, status, error?) => ipcRenderer.invoke('queue:updateStatus', id, status, error),
  delete: (id) => ipcRenderer.invoke('queue:delete', id),
  retry: (id) => ipcRenderer.invoke('queue:retry', id),  // 新增
},
```

### 9. TaskPanel.tsx 修改

在失败任务卡片中添加 Retry 按钮：

```tsx
{task.status === 'failed' && (
  <button
    onClick={() => {
      window.electronAPI.queue.retry(task.id).then(loadTasks)
    }}
    style={{
      marginTop: 4,
      padding: '4px 8px',
      background: '#f0ad4e',
      color: '#fff',
      border: 'none',
      borderRadius: 3,
      cursor: 'pointer',
      fontSize: 11,
    }}
  >
    Retry
  </button>
)}
```

放在 `{task.error && ...}` 之前，与 delete 按钮并列但不互相替代。

### 10. GenerationService 重试计数

`executeGeneration` 的 `catch` 块中，失败时如果需要反映 retryCount，可直接从 task 读取（已在 Queue 中递增）。当前 catch 块只在失败时记录 error，无需大改——retryCount 的递增已在 `TaskQueue.retryTask()` 中处理。

但是需要在 `catch` 块中记录重试次数：

```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  const task = taskQueue.getById(taskId)  // 读取最新的 retryCount
  const retryInfo = task?.retryCount ? ` (retry #${task.retryCount})` : ''
  taskQueue.updateStatus(taskId, 'failed', message)
  this.logger?.error('Service', `Task error${retryInfo}: ${message}`, taskId)
}
```

---

## 验收标准

- [ ] 任一面板崩溃，显示 ErrorBoundary 降级 UI（面板名 + 错误信息 + Retry 按钮），不影响其他面板
- [ ] Adapter 操作失败自动重试 3 次（1s → 2s → 4s 间隔）
- [ ] 失败任务卡片显示 "Retry" 按钮，点击后 status 重置为 pending，worker 自动消费
- [ ] BrowserView crash 后自动重建，重建后 Adapter 引用自动更新
- [ ] IPC 调用超时 10s 后返回明确错误，不会无限挂起
- [ ] TypeScript 零错误 + npm test 通过（补充 ErrorBoundary 测试用例）

## Claude 实现指令

```
实现 Sprint 10: 错误处理与容错

按以下顺序执行，每步完成后验证 TypeScript 编译：

1. src/types/tasks.ts — Task 接口添加 retryCount: number

2. src/database/connection.ts — migrate() 中用 try-catch ALTER TABLE 添加 retry_count 列

3. src/queue/task.queue.ts：
   - rowToTask() 添加 retryCount 映射
   - create() 的 INSERT 添加 retry_count 列
   - 新增 retryTask(id) 方法：failed→pending，retry_count+1，error=NULL

4. src/ui/ErrorBoundary.tsx — 新建 class 组件：
   - Props: { children, panelName }
   - getDerivedStateFromError 捕获错误
   - 降级 UI：panelName + error.message + Retry 按钮

5. src/renderer/App.tsx — 三个面板分别包裹 ErrorBoundary，panelName 分别为 "Task Panel" / "Browser Panel" / "Log Panel"

6. src/adapters/runway.adapter.ts — 添加 withRetry<T>(fn, label, maxRetries=3)：
   - 指数退避：2^i * 1000ms
   - 包装所有 4 个公开方法（selectModel/fillPrompt/clickGenerate/checkStatus）
   - 每个方法独立计数

7. src/browser/browser.manager.ts：
   - attachTo() 中注册 webContents.on('crashed') 和 webContents.on('destroyed')
   - 新增 rebuildBrowserView() 私有方法
   - 新增 setOnRebuild() 回调 + onRebuild 属性

8. src/main/index.ts：
   - 添加 withIpcTimeout 包装所有 ipcMain.handle（10s 超时）
   - browserManager.setOnRebuild() → 重新注入 runwayAdapter.setBrowserView()
   - 注册 queue:retry IPC handler

9. src/preload/index.ts — queue 对象添加 retry 方法

10. src/ui/TaskPanel.tsx — 失败任务卡片添加 "Retry" 按钮，调用 window.electronAPI.queue.retry(id).then(loadTasks)

11. src/services/generation.service.ts — catch 块中读取 retryCount 拼入日志

12. 添加测试：
    - tests/ui/ErrorBoundary.test.tsx：测试正常渲染 + 错误捕获 + Retry 恢复
    - tests/adapters/runway.adapter.test.ts 补充 withRetry 测试（失败 3 次后抛错）

运行 npm test && npm run typecheck 确认全部通过。
```
