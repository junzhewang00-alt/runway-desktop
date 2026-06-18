# Sprint 3 — 登录状态持久化

## TASK-003: SessionManager 实现

**负责人**: Claude  
**优先级**: P0  
**依赖**: Sprint 2 完成

### 描述

使用 Electron `persist:` partition 持久化 Runway 登录状态。

### 验收标准

- [ ] 使用 `persist:runway-session` partition
- [ ] 登录一次后，重启应用仍保持登录
- [ ] 提供 `isLoggedIn()` 状态查询
- [ ] Session 文件存储在 app.getPath('userData') 下

### 关键实现点

```typescript
// BrowserWindow / BrowserView 创建时指定 partition
const session = session.fromPartition('persist:runway-session');
```

### Claude 实现指令

```
实现 SessionManager

要求：
- 使用 Electron persist partition
- 保存 Runway Cookie 到磁盘
- 启动时恢复 session
- 支持读取 isLoggedIn() 状态
- 集成到 BrowserManager（Sprint 2）

不要：
- 不要自己实现 cookie 存储
- 直接用 Electron 原生 persist 能力
```
