# Sprint 5 — Prompt 任务队列

## TASK-005: SQLite Task Queue

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 1 完成

### 描述

使用 SQLite 实现持久化任务队列，管理 Prompt 生成任务的生命周期。

### 验收标准

- [ ] 新增任务（Create）
- [ ] 查询任务列表（Read）
- [ ] 更新任务状态（Update）
- [ ] 删除任务（Delete）
- [ ] 状态机: pending → running → completed / failed
- [ ] 单 worker 轮询消费

### 数据模型

```typescript
interface Task {
  id: string;           // UUID
  prompt: string;       // 用户输入的 prompt
  modelId: string;      // 选中的模型 ID
  status: TaskStatus;   // 当前状态
  createdAt: number;    // 创建时间戳
  updatedAt: number;    // 更新时间戳
  result?: string;      // 生成结果 URL
  error?: string;       // 错误信息
}

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
```

### Claude 实现指令

```
实现 SQLite Task Queue

要求：
- 使用 better-sqlite3
- 状态: pending / running / completed / failed
- 支持 CRUD 操作
- 支持按状态查询
- 队列消费者：轮询 pending 任务，逐个执行
- 单 worker 并发控制

不要：
- 不要实现具体的生成逻辑（调用 Adapter 接口即可）
- 不要引入 redis 或其他外部依赖
```
