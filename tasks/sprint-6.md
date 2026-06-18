# Sprint 6 — 日志系统

## TASK-006: Logger 实现

**负责人**: Claude  
**优先级**: P1  
**依赖**: Sprint 1 完成

### 描述

使用 electron-log 实现全链路日志记录。

### 验收标准

- [ ] 记录字段: timestamp, taskId, module, status, message
- [ ] 日志文件轮转（按大小）
- [ ] 支持导出日志文件
- [ ] 所有 Adapter 操作记录日志
- [ ] 所有 Queue 操作记录日志

### 接口定义

```typescript
interface ILogger {
  info(module: string, message: string, taskId?: string): void;
  warn(module: string, message: string, taskId?: string): void;
  error(module: string, message: string, taskId?: string, error?: Error): void;
  exportLogs(): Promise<string>;  // 返回导出文件路径
}
```

### 日志示例

```
[2026-06-08 14:30:00] [INFO]  [Queue]    task-001 | Task created: "a cat walking"
[2026-06-08 14:30:01] [INFO]  [Queue]    task-001 | Task started
[2026-06-08 14:30:02] [INFO]  [Adapter]  task-001 | Selecting model: Gen-4
[2026-06-08 14:30:03] [INFO]  [Adapter]  task-001 | Fill prompt
[2026-06-08 14:30:04] [INFO]  [Adapter]  task-001 | Click generate
[2026-06-08 14:30:30] [INFO]  [Adapter]  task-001 | Generation completed
[2026-06-08 14:30:30] [INFO]  [Queue]    task-001 | Task completed
```

### Claude 实现指令

```
实现 Logger

要求：
- 使用 electron-log
- 字段: timestamp, taskId, module, level, message
- 支持日志文件轮转
- 支持 exportLogs() 导出
- 单例模式
- 在 Adapter 和 Queue 中集成日志调用
```
