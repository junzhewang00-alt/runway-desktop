# ADR-001: 选择 BrowserView 而非 webview 标签

## 状态

已采纳

## 上下文

需要在 Electron 应用中嵌入 Runway 网页。有2个方案：

1. **webview 标签**：在 React 组件中直接使用 `<webview>` 标签
2. **BrowserView**：通过主进程 API 创建独立的 BrowserView

## 决策

选择 **BrowserView**。

## 理由

- BrowserView 是独立进程，性能隔离更好
- 不与 React 虚拟 DOM 耦合
- 支持 `persist:` partition 原生持久化
- `executeJavaScript` 等 API 更丰富
- 与 Adapter 架构更匹配（主进程控制）

## 影响

- UI 层无法直接控制 BrowserView，必须通过 IPC 通信
- 需要 BrowserManager 管理生命周期
- 渲染进程和 BrowserView 的坐标同步需要额外处理
