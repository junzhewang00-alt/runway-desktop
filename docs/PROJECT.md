# Runway Desktop Client

## 项目名称

**Runway Desktop Client** — 公司内部 AI 视频生产工具

## 当前版本

**v0.1.0** — MVP 已完成 (Sprint 1-8)

## 目标

将 RunwayML 的 AI 视频生成能力封装为桌面应用，通过 Electron + BrowserView 嵌入 Runway 网页端，提供任务队列、模型切换、日志追踪等生产级功能，降低团队使用 Runway 的门槛。

## MVP 功能（已交付）

| 功能 | 描述 | 状态 |
|------|------|------|
| Runway 嵌入 | 通过 BrowserView 加载 Runway 网页，用户直接在应用内操作 | ✅ |
| 登录状态保存 | Electron Session persist，重启后保持登录态 | ✅ |
| Prompt 队列 | SQLite 持久化任务队列，支持排队生成 | ✅ |
| 多模型切换 | 配置化模型能力表，切换 Gen-4、Aleph、Seedance 2 等 | ✅ |
| 日志系统 | 全操作日志记录，支持导出 | ✅ |
| 三栏布局 | TaskPanel / BrowserPanel / LogPanel 可拖拽布局 | ✅ |

## Phase 2 功能（开发中）

| 功能 | Sprint |
|------|--------|
| Adapter DOM 真实实现 | Sprint 9 |
| 全局错误处理 + 重试 | Sprint 10 |
| 生成历史 + 缩略图 | Sprint 11 |
| 批量导入 + 优先级 | Sprint 12 |
| 自动下载 | Sprint 13 |
| 快捷键 + 通知 + 深色模式 | Sprint 14 |

## 不做（Anti-Scope）

- 多平台（首期仅 Windows）
- 云同步
- 用户系统 / 多账号
- SaaS 化能力
- 自动更新

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 33 |
| 前端 | React 18 + TypeScript |
| 构建 | Vite + electron-vite |
| 持久化 | better-sqlite3 (SQLite) |
| 嵌入方案 | BrowserView |
| 日志 | electron-log |

## 团队分工

| 角色 | 人员 | 职责 |
|------|------|------|
| PM + Architect | Trae | 需求、任务拆解、架构约束、代码审查、验收 |
| Senior Engineer | Claude | 编码实现、重构、测试、修 Bug |
