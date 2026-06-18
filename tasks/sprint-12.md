# Sprint 12 — 任务增强

## TASK-012: 批量导入 + 优先级 + 搜索

**负责人**: Claude  
**优先级**: P1  
**依赖**: Sprint 5, 8 完成

### 描述

增强任务系统的实用性：支持批量导入、优先级排序、搜索过滤、备注标签。

### 实现要求

#### 1. Task 数据模型扩展

```typescript
interface Task {
  id: string;
  prompt: string;
  modelId: string;
  status: TaskStatus;
  priority: TaskPriority;    // 新增
  note: string;              // 新增
  retryCount: number;        // 新增 (Sprint 10 也用到)
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
}

type TaskPriority = 'high' | 'medium' | 'low';
```

SQL 迁移：

```sql
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
```

#### 2. 批量导入

- `TaskPanel` 新增 "批量导入" 按钮
- 弹出模态框，支持两种方式：
  - **粘贴**: 文本框粘贴多行，每行一个 prompt
  - **文件**: 拖入 .txt 文件，逐行解析
- 批量创建时统一选择模型
- 显示创建进度 (n/总数)

#### 3. 优先级消费

- `TaskQueue.start()` 中的轮询查询改为按优先级排序：

```sql
SELECT * FROM tasks 
WHERE status = 'pending' 
ORDER BY 
  CASE priority 
    WHEN 'high' THEN 1 
    WHEN 'medium' THEN 2 
    WHEN 'low' THEN 3 
  END, 
  created_at ASC 
LIMIT 1;
```

#### 4. 备注

- 创建任务时可填写可选备注
- 任务卡片显示备注首行
- 展开可查看完整备注

#### 5. 搜索/过滤

- `TaskPanel` 顶部添加搜索框
- 实时过滤（客户端过滤，不额外 IPC）
- 按 prompt 关键词匹配
- 按状态标签过滤（点击标签切换）

### 验收标准

- [ ] 粘贴 5 行文本可批量创建 5 个任务
- [ ] 支持 .txt 文件拖入导入
- [ ] 高优先级任务在 pending 中排到最前面
- [ ] 创建任务时可填写备注
- [ ] 搜索框输入关键词可实时筛选任务列表
- [ ] 点击状态标签可过滤对应状态的任务

### Claude 实现指令

```
实现 Sprint 12: 任务增强

要求：
1. 数据库迁移
   - tasks 表添加 priority (TEXT, 默认 'medium'), note (TEXT, 默认 ''), retry_count (INTEGER, 默认 0)
   - 更新 src/database/connection.ts 的 migrate()

2. 类型更新
   - src/types/tasks.ts: Task 接口添加 priority, note, retryCount
   - TaskPriority = 'high' | 'medium' | 'low'

3. 批量导入
   - src/ui/TaskPanel.tsx 添加 "Batch Import" 按钮
   - 弹出模态框: <textarea> 粘贴 + 文件拖放区
   - 解析：按换行分割，过滤空行
   - 批量调用 window.electronAPI.queue.create()
   - 显示 "已创建 3/5" 进度

4. 优先级队列
   - src/queue/task.queue.ts 的 start() 查询改为 ORDER BY priority
   - TaskPanel 创建任务时显示优先级选择（high/medium/low 下拉）
   - 任务卡片显示优先级颜色标签（high=红, medium=黄, low=灰）

5. 搜索过滤
   - TaskPanel 顶部搜索框
   - 客户端 filter (tasks.filter())，不需要新 IPC
   - 状态标签可点击切换过滤

注意：
- 模态框用纯 CSS/React 实现，不引入第三方库
- 文件拖放用 HTML5 Drag & Drop API
```
