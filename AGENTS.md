# AGENTS.md — Codex 编码永久规则

## 当前阶段

**Phase 2: Production Hardening** (Sprint 9-14)

## 核心原则

### 架构红线

1. **所有 Runway 操作必须经过 Adapter**
   - 唯一与 Runway 网页交互的模块是 `src/adapters/runway.adapter.ts`
   - 任何其他模块不得直接操作 BrowserView 或 Runway DOM
   - DOM 选择器集中在 `src/adapters/runway.selectors.ts` 管理

2. **禁止在 React 组件中出现**
   - `document.querySelector` / `document.getElementById`
   - `executeJavaScript`（Electron）
   - `webContents.send`
   - 任何直接的 DOM 操作
   - React 组件只能通过 IPC 或 Service 层通信

3. **所有任务必须经过 Queue**
   - 生成任务必须通过 `src/queue/task.queue.ts`
   - 不允许 Adapter 被 UI 直接调用
   - 数据流: UI → Service → Queue → Adapter → DownloadManager

4. **所有关键操作必须记录 Logger**
   - Adapter 操作: selectModel, fillPrompt, clickGenerate, checkStatus
   - Queue 操作: create, start, complete, fail
   - Service 操作: 所有公开方法
   - Download 操作: start, progress, complete, fail

5. **错误处理必须覆盖所有异步边界**
   - Adapter 操作必须带超时（30s）
   - IPC handler 必须 try-catch
   - React 组件必须被 ErrorBoundary 包裹

### 禁止引入的功能

- 用户系统 / 多账号
- 云同步
- SaaS 能力
- 自动更新

### Phase 2 新增约束

1. **DOM 选择器配置化**
   - 所有 Runway 页面的 CSS 选择器必须在 `src/adapters/runway.selectors.ts` 中定义
   - 禁止在 Adapter 方法中硬编码选择器字符串
   - 选择器变更只改配置文件

2. **错误处理**
   - 每个 React 面板必须有 ErrorBoundary
   - Adapter 操作必须用 `withRetry` 包装
   - BrowserView crash 必须自动恢复

3. **数据持久化**
   - generations 表记录生成历史
   - 下载文件存 `<userData>/downloads/`
   - 缩略图缓存 `<userData>/thumbnails/`
   - 用户偏好存 localStorage（主题、面板折叠）

### 编码规范

1. **配置驱动，禁止硬编码**
   - 模型列表从 `src/types/models.ts` 的 `MODEL_CAPS` 读取
   - UI 组件不得硬编码模型名称
   - 颜色使用 CSS 变量，禁止硬编码色值

2. **依赖注入**
   - Adapter 通过 setter 注入 BrowserView 引用
   - Service 通过 setter 注入 Queue / Adapter / Logger / DownloadManager

3. **类型安全**
   - 所有公开接口必须有 TypeScript 类型
   - 禁止使用 `any`（除非确有需要并加注释说明）

4. **优先保证**
   - 稳定性 > 功能
   - 可维护性 > 代码量少
   - 可扩展性 > 性能优化

### 项目结构约定

```
src/
├─ main/         # Electron 主进程 + IPC 路由 + 依赖注入编排
├─ preload/      # Preload 脚本（contextBridge）
├─ renderer/     # React 渲染进程 + 主题 CSS 变量
├─ adapters/     # Runway 适配器 + DOM 选择器配置
├─ browser/      # BrowserView 管理 + Session 管理
├─ database/     # SQLite 连接 + 迁移
├─ download/     # 下载管理器（Phase 2 新增）
├─ logs/         # 日志系统
├─ queue/        # 任务队列（支持优先级排序）
├─ services/     # 业务服务 + 通知服务
├─ types/        # 共享类型定义
└─ ui/           # React 组件
tests/           # 集成测试（Phase 2 新增）
```

### 开发流程

1. 按 Sprint 编号顺序执行（9 → 10 → 11 → 12 → 13 → 14）
2. 每完成一个 Sprint，对照 `tasks/sprint-N.md` 的验收标准自查
3. 不要跨 Sprint 提前实现后续功能
4. 遇到架构问题，先查 `docs/ARCHITECTURE.md` 的约束
5. 不确定的实现方案，先查 `docs/ADR/` 的技术决策记录

### 禁止行为总结

| 禁止 | 原因 |
|------|------|
| UI 中 `document.querySelector` | 破坏架构分层 |
| UI 中 `executeJavaScript` | 必须通过 Adapter |
| UI 直接调 Adapter | 必须通过 Queue |
| 硬编码模型/颜色到 UI | 配置驱动 / CSS 变量 |
| 硬编码 DOM 选择器 | 统一在 runway.selectors.ts |
| 无超时的 Adapter 操作 | 必须 30s 超时 |
| 引入用户系统 | Anti-Scope |
| 引入云同步 | Anti-Scope |
