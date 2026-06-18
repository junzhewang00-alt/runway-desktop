# ROADMAP — Runway Desktop Client

## Phase 1: MVP ✅ 已完成

| Sprint | 模块 | 状态 |
|--------|------|------|
| Sprint 1 | Electron 基础框架 | ✅ |
| Sprint 2 | BrowserView 管理器 | ✅ |
| Sprint 3 | 登录状态持久化 | ✅ |
| Sprint 4 | Runway Adapter 接口 | ✅ |
| Sprint 5 | SQLite 任务队列 | ✅ |
| Sprint 6 | 日志系统 | ✅ |
| Sprint 7 | 模型管理 | ✅ |
| Sprint 8 | 主界面 MVP | ✅ |

---

## Phase 2: Production Hardening 🚧 当前

### Sprint 9: Adapter DOM 实现 + 集成测试

**目标**: 将 Adapter 中的 TODO 占位替换为真实 Runway DOM 选择器

- 在 Runway 网页上实测 selectModel/fillPrompt/clickGenerate
- DOM 选择器配置化（CSS 选择器集中管理）
- Adapter 每个方法添加超时 (30s)
- 添加集成测试用例（mock BrowserView）

**验收标准**:
- 在 Runway 页面上能成功 selectModel
- 能成功 fillPrompt 并 clickGenerate
- 超时后返回明确错误而非静默失败
- 测试用例覆盖 happy path + timeout 路径

---

### Sprint 10: 错误处理与容错

**目标**: 全局异常边界 + 重试机制

- React Error Boundary 组件
- Adapter 操作自动重试 (max 3 次, exponential backoff)
- Queue 失败任务支持手动重试
- IPC 超时处理
- BrowserView 崩溃恢复

**验收标准**:
- React 组件崩溃不白屏，显示 ErrorBoundary 降级 UI
- Adapter 操作失败自动重试 3 次
- 失败任务可点击 "重试" 按钮
- BrowserView crash 后自动重建

---

### Sprint 11: 生成历史

**目标**: 历史记录面板 + 缩略图预览

- 新增 `generations` 表（SQLite）
- 历史列表 UI（按时间倒序）
- 缩略图预览（Runway 返回的视频首帧）
- 按日期/模型筛选
- 重新生成功能

**验收标准**:
- 历史面板显示过往所有生成记录
- 支持按模型和日期筛选
- 点击记录可预览缩略图
- 可从历史记录一键"重新生成"

---

### Sprint 12: 任务增强

**目标**: 批量操作 + 任务优先级 + 备注

- 批量导入 Prompt（粘贴多行 / 文件导入）
- 任务优先级（high / medium / low）
- 队列优先级排序消费
- 任务备注字段
- 任务搜索/过滤

**验收标准**:
- 支持粘贴多行文本批量创建任务
- 高优先级任务优先消费
- 任务卡片显示备注
- 搜索框可按关键词过滤任务

---

### Sprint 13: 自动下载

**目标**: 生成完成后自动下载视频

- 完成后从 Runway 页面获取视频 URL
- Electron downloadItem API 下载
- 本地下载目录管理
- 下载进度显示
- 下载完成通知

**验收标准**:
- 视频生成后自动开始下载
- 下载进度在 TaskPanel 中显示
- 下载到 `~/RunwayDownloads/` 目录
- 下载完成桌面通知

---

### Sprint 14: UX 优化

**目标**: 快捷键 + 通知 + 深色模式

- 全局快捷键（Ctrl+N 新任务等）
- 桌面通知（生成完成/下载完成）
- 深色/浅色主题切换
- 键盘操作优化（Tab 切换面板、Enter 提交）
- 面板折叠/展开

**验收标准**:
- 快捷键在各面板正常工作
- 任务完成弹出 Windows 通知
- 深色模式切换流畅
- 纯键盘可完成"创建任务 → 查看状态"全流程

---

## Phase 3: Scale (未来)

| ID | 标题 |
|----|------|
| BL-005 | 多平台支持 (macOS) |
| BL-008 | 多 Runway 账号切换 |
| BL-009 | 生成模板系统 |
| BL-010 | 团队共享队列 |
