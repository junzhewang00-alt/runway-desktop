# Sprint 11 — 生成历史

## TASK-011: 历史记录 + 缩略图预览

**负责人**: Claude  
**优先级**: P1  
**依赖**: Sprint 5, 8 完成

### 描述

当前任务完成后没有持久化记录生成结果。本 Sprint 新增生成历史功能。

### 数据模型

```sql
-- 新增表
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,         -- UUID
  task_id TEXT NOT NULL,       -- 关联任务
  prompt TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  video_url TEXT,              -- 视频 URL
  thumbnail_path TEXT,         -- 本地缩略图路径
  status TEXT NOT NULL DEFAULT 'completed',
  duration_seconds INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 实现要求

#### 1. 数据库迁移

- `src/database/connection.ts` 中添加 `generations` 表迁移
- `GenerationService` 在任务完成时写入 `generations` 记录
- 从 `RunwayAdapter.waitForCompletion()` 返回的 `GenerationResult` 中提取 `videoUrl`

#### 2. 历史面板 UI

- 在应用中新增 "History" 标签（与 TaskPanel 并列，或作为 Tab 切换）
- 卡片列表显示: 缩略图 + prompt 前 80 字符 + 模型名 + 时间
- 点击卡片展开详情
- 筛选器: 按模型下拉 + 按日期范围

#### 3. 缩略图

- 如果 Runway 返回视频 URL，尝试下载首帧作为缩略图
- 缩略图缓存到 `<userData>/thumbnails/`
- 如果无法获取缩略图，显示默认占位图

#### 4. 重新生成

- 每条历史记录有 "重新生成" 按钮
- 点击后使用相同 prompt + model 创建新任务

### 验收标准

- [ ] 任务完成后自动写入 `generations` 表
- [ ] 历史面板按时间倒序显示
- [ ] 支持按模型筛选
- [ ] 支持按日期范围筛选
- [ ] 点击记录可查看详情（全 prompt + 时间 + 模型 + 视频链接）
- [ ] "重新生成" 按钮可一键创建新任务

### Claude 实现指令

```
实现 Sprint 11: 生成历史

要求：
1. 数据库迁移
   - src/database/connection.ts 中添加 generations 表
   - 字段: id, task_id, prompt, model_id, model_name, video_url, thumbnail_path, status, created_at

2. 历史写入
   - src/services/generation.service.ts 的 executeGeneration() 完成后
   - 将结果写入 generations 表
   - videoUrl 从 RunwayAdapter.waitForCompletion() 的返回值获取

3. UI
   - src/ui/HistoryPanel.tsx — 历史列表组件
   - src/renderer/App.tsx — 添加 History Tab 或切换视图
   - 列表项: 缩略图(或占位图) + prompt 前 80 字符 + 模型名 + 相对时间
   - 筛选栏: 模型下拉 + 日期选择
   - 详情弹出层或内联展开

4. IPC
   - 预加载暴露: history:list, history:getById
   - 主进程注册对应 handler

注意：
- 缩略图获取是可选的，如果无法获取用占位图
- 不用引入复杂的日期选择器库，用原生 <input type="date">
- 保持与现有 TaskPanel 风格一致
```
