# ADR-002: 使用 SQLite 而非文件存储

## 状态

已采纳

## 上下文

任务队列需要持久化存储。可选方案：

1. **JSON 文件**：读写文件
2. **SQLite**：嵌入式数据库

## 决策

选择 **SQLite**（better-sqlite3）。

## 理由

- 支持并发读写（文件方案需要加锁）
- 查询过滤方便（按状态、时间等）
- 数据完整性（事务支持）
- better-sqlite3 同步 API，不需要处理异步回调
- 与 Electron 主进程天然契合

## 影响

- 依赖 better-sqlite3 native module
- 需要处理 native module 在不同平台的编译
- 数据库文件需存储在 app.getPath('userData') 中
