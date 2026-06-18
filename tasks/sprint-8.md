# Sprint 8 — 主界面 MVP

## TASK-008: 三栏布局 UI

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 2、5、6、7 完成

### 描述

实现三栏布局的 MVP 主界面。

### 验收标准

- [ ] 左侧: TaskPanel（任务列表 + 增删改操作）
- [ ] 中间: BrowserPanel（嵌入 Runway BrowserView）
- [ ] 右侧: LogPanel（实时日志流）
- [ ] 布局可拖动调整比例
- [ ] 所有组件通过 Service 层通信，不直接调用 Adapter

### 布局

```
┌────────────┬───────────────────┬──────────┐
│            │                   │          │
│  TaskPanel │   BrowserPanel    │ LogPanel │
│  (280px)   │    (flex: 1)      │ (320px)  │
│            │                   │          │
│ ┌────────┐ │                   │ ┌──────┐ │
│ │ Add    │ │   [Runway Web]    │ │ log1 │ │
│ │ Task   │ │                   │ │ log2 │ │
│ ├────────┤ │                   │ │ log3 │ │
│ │ Task 1 │ │                   │ │ ...  │ │
│ │ Task 2 │ │                   │ └──────┘ │
│ │ Task 3 │ │                   │          │
│ └────────┘ │                   │          │
└────────────┴───────────────────┴──────────┘
```

### 组件树

```typescript
// src/ui/
TaskPanel.tsx      // 任务列表 + 操作按钮
BrowserPanel.tsx   // BrowserView 容器（通过 IPC 通信）
LogPanel.tsx       // 日志流显示 + 导出按钮
App.tsx            // 三栏布局容器
```

### 数据流

```
TaskPanel → ipcRenderer.invoke('queue:create', task)
         → Main Process (Queue) → Adapter → BrowserView
         
LogPanel  ← ipcRenderer.on('log:new', entry)
          ← Main Process (Logger)
```

### Claude 实现指令

```
实现 MVP UI

布局：
- 三栏布局: TaskPanel | BrowserPanel | LogPanel
- 使用 CSS Grid 或 Flexbox，支持拖拽调整
- 响应式最小宽度限制

TaskPanel：
- 任务列表（从 Queue 读取）
- "新建任务" 按钮 → 弹出 prompt 输入对话框
- 任务右键菜单：暂停/恢复/删除
- 通过 IPC 通信，不直接调 Adapter

BrowserPanel：
- 通过 IPC 通知主进程创建/管理 BrowserView
- 使用 UIView 或类似机制嵌入 BrowserView（Electron 特定）
- 刷新按钮

LogPanel：
- 实时日志流（IPC push）
- 导出日志按钮
- 自动滚动到底部

所有 Runway 操作必须经过 Adapter
禁止在 React 组件中出现 document.querySelector 或 executeJavaScript
所有任务必须经过 Queue
所有关键操作必须记录 Logger
```
