# Sprint 2 — BrowserView 管理器

## TASK-002: BrowserManager 实现

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 1 完成

### 描述

实现 BrowserManager 类，管理 Electron BrowserView 的生命周期。

### 验收标准

- [ ] 创建 BrowserView 并加载 Runway URL
- [ ] 支持 `reload()`
- [ ] 支持 `openDevTools()`
- [ ] BrowserView 随窗口 resize
- [ ] 窗口关闭时自动销毁 BrowserView

### 接口定义

```typescript
interface IBrowserManager {
  loadURL(url: string): Promise<void>;
  reload(): void;
  openDevTools(): void;
  setBounds(x: number, y: number, width: number, height: number): void;
  destroy(): void;
  getBrowserView(): BrowserView;
}
```

### Claude 实现指令

```
实现 BrowserManager

功能：
- 创建 BrowserView
- 加载指定 URL
- 支持 reload()
- 支持 openDevTools()
- 监听主窗口 resize，同步 BrowserView bounds

要求：
- 单例模式
- 监听窗口 close 事件自动销毁
- 使用 persist: session 为后续 Sprint 3 做准备
```
