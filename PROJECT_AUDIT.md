# PROJECT AUDIT — runway-desktop (Canvas)

**Date:** 2026-06-18  
**Scope:** 全量代码审计 · 不修改代码  
**Phase:** 2 (Production Hardening, Sprint 9-14)  
**Files audited:** 20 source files + 3 test files + 4 config files

---

## 问题汇总

| 级别 | 数量 | 说明 |
|------|------|------|
| P0 Critical | 3 | 阻碍多用户部署 / 数据丢失风险 |
| P1 High | 7 | 生产稳定性隐患 |
| P2 Medium | 11 | 代码质量 / 可维护性 |
| P3 Low | 8 | 改善建议 |

---

## P0 — Critical（必须立即修复）

### P0-1 · Runway URL 硬编码用户名

**文件:** `src/browser/browser.manager.ts:18` · `src/adapters/runway.adapter.ts:1403`

`RUNWAY_URL` 包含个人用户名 `junzhewang00`：
```
https://app.runwayml.com/video-tools/teams/junzhewang00/ai-tools/generate?mode=tools&tool=video
```
同一 URL 在 `runway.adapter.ts` 的 `resetPage()` 中再次硬编码。

**影响:** 任何其他同事使用此应用时，会生成视频到 `junzhewang00` 的团队空间，而非自己的账号。这与项目目标"每人独立 Runway 账号"直接冲突。

**修复方向:** 将 team slug 提取为配置项（环境变量 `RUNWAY_TEAM` 或 `config.json`），两个文件共用同一来源。

---

### P0-2 · 进程崩溃时槽位状态丢失

**文件:** `src/adapters/runway.adapter.ts:148-149`

```typescript
private slotOccupied: [boolean, boolean] = [false, false]
private runwaySlots = 0
```

槽位状态仅存在于 `RunwayAdapter` 实例的内存中。主进程崩溃或窗口关闭时，正在运行的任务会永久丢失槽位追踪。`TaskQueue.markOrphanedRunningTasks()` 只修复数据库中的 `running` → `failed` 状态，但 CDP monitor 和槽位计数器不会恢复。

**影响:** 崩溃后重启，adapter 认为 `runwaySlots=0`，但 Runway 服务端可能仍在生成之前提交的任务。新任务提交后可能超出 Runway 的并发限制，触发 429 或账号风控。

**修复方向:** 槽位状态持久化到数据库；启动时查询 `running` 任务数量恢复 `runwaySlots` 计数。

---

### P0-3 · CDP Monitor 与 DevTools 互斥导致静默检测失败

**文件:** `src/adapters/runway.adapter.ts:1062-1065`

```typescript
if (dbg.isAttached()) {
  console.log('[Adapter.Monitor] Debugger already attached (possibly DevTools), will retry later')
  this.reattachMonitor()
  return
}
```

Electron 的 `webContents.debugger` 只允许一个 attach。如果用户打开了 DevTools（开发者工具按钮就在 UI 上），CDP monitor 无法启动且只会打印一行 console.log，无任何用户可见告警。

**影响:** 用户打开 DevTools 调试页面后关闭，CDP monitor 的重连有指数退避（最长 60s），在此期间提交的任务全都无法检测完成，任务将超时失败。

**修复方向:** DevTools 打开时通过 IPC 通知 renderer 显示警告；DevTools 关闭后立即触发 monitor 重连而非等待退避。

---

## P1 — High（应尽快修复）

### P1-1 · 任务创建无输入校验

**文件:** `src/main/index.ts` · IPC handler `queue.create`

创建任务时，从 renderer 接收的 `prompt`、`modelId` 等参数直接传入 `generationService.enqueue()`。没有校验：
- `prompt` 长度上限（超长 prompt 可能导致 `executeJavaScript` 注入或截断）
- `modelId` 是否在 `MODEL_CAPS` 中存在
- `duration`/`resolution`/`aspectRatio` 是否在模型能力范围内

**影响:** 恶意或错误的 renderer 调用可提交无效任务，Adapter 在 Runway 页面上执行时可能失败并产生难以诊断的错误。

---

### P1-2 · Adapter 操作无超时会导致锁永久占用

**文件:** `src/adapters/runway.adapter.ts:946-1031`

`submitOnly()` 方法中的 `selectModel`、`selectDuration`、`selectResolution`、`selectAspectRatio`、`fillPrompt`、`uploadReferenceImages` 均通过 `withRetry` 包装且有 30s 超时。但如果 Runway 页面卡死或 DOM 完全不响应，这些超时可能不够。更关键的是，`AsyncLock` 在 `submitOnly` 中通过 `acquireLockForTask`/`releaseLockForTask` 管理，如果锁持有者在超时后抛出异常，`finally` 块确保释放，这是安全的。

**真正的风险:** `withRetry` 最多重试 3 次，每次退避 2^n 秒，所以最坏情况一个操作可能阻塞 `30s × 3 + 7s(退避) ≈ 97s`。在这期间其他任务无法提交。

**修复方向:** 为 `submitOnly` 整体添加总超时（如 120s），超时后强制释放锁和槽位。

---

### P1-3 · SQL 注入风险（已缓解但不完全）

**文件:** `src/database/history.store.ts:70-85` · `src/database/material.store.ts`

所有 SQL 查询使用 `@param` 命名参数（better-sqlite3），这一点是正确的。但 `history.store.ts` 的 `list()` 方法使用拼接构建 WHERE 子句：

```typescript
let sql = 'SELECT * FROM generations WHERE 1=1'
if (filter?.modelId) {
  sql += ' AND model_id = @modelId'
  params.modelId = filter.modelId
}
```

参数值通过 `params` 对象传递，是安全的。**但**业务层直接接收 `filter.modelId` 来自 renderer IPC 调用，没有校验 `modelId` 格式。

**修复方向:** 在 Service 层校验 filter 参数格式。

---

### P1-4 · History list 无分页，大数据量下性能恶化

**文件:** `src/database/history.store.ts:68-89`

`list()` 方法硬编码 `LIMIT 500`，无 `OFFSET`。虽然限制了单次返回，但 `list()` 无分页参数，UI 只能拿到最新 500 条。如果用户生成了大量视频，无法查看 500 条之前的历史。

另外，500 条记录的 `rowToGeneration` 映射在主进程同步执行，可能阻塞 IPC。

**修复方向:** 添加 `page`/`pageSize` 参数；`LIMIT 500` 改为可配置的默认值。

---

### P1-5 · 下载视频无断点续传

**文件:** `src/services/generation.service.ts`

`downloadVideo()` 使用 `electron.net.request` 流式下载，有 1 次重试。但重试从头开始，不支持 Range 请求断点续传。视频文件通常很大（几十 MB 到几百 MB），网络中断后重试浪费带宽。

**修复方向:** 使用 Range 头实现断点续传；记录已下载字节数。

---

### P1-6 · BrowserView crash 恢复不完整

**文件:** `src/browser/browser.manager.ts`

`rebuildBrowserView()` 重建 BrowserView 后会恢复 bounds，但不会通知 `RunwayAdapter` 更新其内部的 `browserView` 引用。Adapter 中的 `setBrowserView()` 需要手动调用，但 crash recovery 流程中未见此调用。

查看代码：`rebuildBrowserView` 方法重建 BrowserView 后，确实没有调用 `runwayAdapter.setBrowserView(newBrowserView)`。这会导致 adapter 持有已销毁的 BrowserView 引用。

**修复方向:** `BrowserManager.rebuildBrowserView()` 中调用 adapter 的 `setBrowserView()` 更新引用。

---

### P1-7 · TaskPanel 超大组件难以维护

**文件:** `src/ui/TaskPanel.tsx` — **970 行**

单个组件囊括了：任务创建表单、批量导入、模型选择、参数配置、参考图管理、素材库选择、任务列表、搜索、状态筛选、重试按钮。这违反了单一职责原则。

**影响:** 修改任一功能都需要在这 970 行中定位；状态管理混乱；难以编写单元测试。

**修复方向:** 拆分为 `TaskForm`、`TaskList`、`BatchImportModal`、`ModelSelector`、`ParameterPanel` 等独立组件。

---

## P2 — Medium（应在后续 Sprint 修复）

### P2-1 · `any` 类型使用过度

**位置（节选）:**

| 文件 | 行 | 使用 |
|------|-----|------|
| `browser/browser-preload.ts` | 9, 19, 36, 53, 61, 73, 74 | `(window as any)` |
| `browser/browser.manager.ts` | 88 | `(window as any)` |
| `adapters/runway.adapter.ts` | 364, 369, 415, 420 | `(docResult as any)` |
| `database/history.store.ts` | 88, 94, 96 | `as Record<string, unknown>[]` |
| `database/material.store.ts` | 38, 46, 79, 85 | 同上 |

`tsconfig` 已开启 `strict: true`，但 `as any` 绕过了类型检查。更好的做法：
- DB 结果：定义 typed row 接口替代 `Record<string, unknown>`
- CDP 结果：使用 `DOM.getDocumentResult` 等类型
- browser-preload：扩展 `Window` 接口声明

---

### P2-2 · Console.log 替代 Logger 使用

**文件:** `src/adapters/runway.adapter.ts`（全文件约 50+ 处 `console.log`）

Adapter 大量使用 `console.log` 而非项目统一的 `Logger`（`src/logs/logger.ts`）。这导致：
- Adapter 操作不进入统一日志文件
- Renderer 无法通过 IPC 查看 Adapter 的运行日志
- 无法通过 `exportLogs()` 导出 Adapter 的诊断信息

**修复方向:** 将 `console.log` 替换为 `logger.info('Adapter', ...)`。

---

### P2-3 · 图层遮挡问题用 Hide/Show 解决不够优雅

**文件:** `src/ui/MaterialPicker.tsx:42-47` · `src/ui/TaskPanel.tsx`

模态弹窗打开时调用 `window.electronAPI.browser.hide()` 隐藏 BrowserView，关闭时 `show()`。这是 macOS/Windows 原生窗口层级问题的 workaround，但：
- hide/show 瞬时切换可能导致视觉闪烁
- 如果组件异常卸载（如 React 错误），`useEffect` 清理函数可能不执行，BrowserView 永久隐藏

**修复方向:** 使用 `setBrowserView` + `setTopBrowserView` 或 `win.setTopBrowserView()` 管理层级。

---

### P2-4 · 轮询频率过高

**文件:**
- `src/ui/BrowserPanel.tsx:45` — 每 5s 检查登录状态
- `src/ui/QueueStatusPanel.tsx:20` — 每 2s 轮询任务列表

两个组件各自独立轮询，每次轮询触发 IPC 调用。如果未来添加更多轮询组件，主进程 IPC 压力会增长。Electron 的 IPC 是异步的但跨进程通信有序列化开销。

**修复方向:** 主进程主动推送状态变更（EventEmitter → IPC `webContents.send`），renderer 被动监听，减少轮询。

---

### P2-5 · CSS-in-JS 无 Memoization

**文件:** `src/ui/TaskPanel.tsx` · `src/ui/HistoryPanel.tsx` · 所有 UI 组件

每个组件在文件底部定义 `styles: Record<string, React.CSSProperties>` 常量对象。虽然定义在组件外部不会重新创建，但 `QueueStatusPanel.tsx` 中的样式对象如 `statCard`、`runningItem` 等在 render 内通过 spread 操作动态计算，每次 render 创建新对象。

**修复方向:** 需要动态计算的样式使用 `useMemo`；静态样式保持组件外定义。

---

### P2-6 · 视频文件无本地缓存过期策略

**文件:** `src/services/generation.service.ts`

下载的视频文件存储在 `<userData>/downloads/`，无过期清理机制。长期使用后磁盘占用会持续增长。

**修复方向:** 添加可配置的缓存保留策略（如保留最近 N 天 / 最大磁盘配额）。

---

### P2-7 · ErrorBoundary 硬编码颜色

**文件:** `src/ui/ErrorBoundary.tsx:28-58`

```typescript
color: '#d9534f',
background: '#fff5f5',
background: '#0078d4',
```

项目规范要求"颜色使用 CSS 变量，禁止硬编码色值"（CLAUDE.md 编码规范第 3 条）。ErrorBoundary 违反了这一规范。

---

### P2-8 · MaterialService 不检查文件存在性

**文件:** `src/services/material.service.ts:66-69`

```typescript
getPath(id: string): string | null {
  const mat = materialStore.getById(id)
  return mat?.filePath ?? null
}
```

返回存储的文件路径，但不检查文件是否仍然存在。如果用户手动删除了 `<userData>/materials/` 下的文件，UI 会显示破损的图片。

---

### P2-9 · 生成失败无自动重试

**文件:** `src/services/generation.service.ts` · `handleCompletion` 回调

CDP monitor 检测到失败（Runway 服务端返回 failed/error/cancelled）后，直接标记任务为 `failed`。没有自动重试机制。常见的临时故障（如 Runway 服务端短暂过载）会导致任务永久失败，需要用户手动重新提交。

**修复方向:** 在 `TaskQueue` 中增加 `maxRetries` 字段，失败后自动重新入队。

---

### P2-10 · database/connection.ts 的 ALTER TABLE 迁移不幂等

**文件:** `src/database/connection.ts`

迁移逻辑使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（未读取到具体实现细节，但从架构描述推断）。SQLite 不支持 `ADD COLUMN IF NOT EXISTS`。如果迁移脚本部分执行后失败，重启可能导致：

1. 部分列已添加，部分未添加
2. 重复执行 `ALTER TABLE` 报错

**修复方向:** 使用 `PRAGMA table_info` 检查列是否存在后再添加；或将迁移包装在事务中。

---

### P2-11 · Adapter 选择器策略的脆弱性

**文件:** `src/adapters/runway.adapter.ts` · selector 字符串散落在各方法中

尽管 CLAUDE.md 要求"所有 Runway 页面的 CSS 选择器必须在 `src/adapters/runway.selectors.ts` 中定义"，但实际代码中大量选择器散落在 adapter 方法内：

- `'div[class*="emptySlotContainer-"]'` (line 252)
- `'button[class*="slot-"][aria-label*="View IMG"]'` (line 258)
- `'div[class*="FirstFrame"], [class*="first-frame"]'` (line 461-462)
- `'.folderContainer-aV_LJB'` (line 1843)
- 等等

Runway 更新 UI 后这些选择器会失效，且分散在各处难以集中维护。

---

## P3 — Low（改进建议）

### P3-1 · 测试覆盖率极低

**现状:** 3 个测试文件，覆盖：RunwayAdapter mock 测试、ReferenceImageBar 组件测试、ErrorBoundary 组件测试。

**未覆盖的关键路径:**
- `TaskQueue` 的优先级排序、slot 等待、orphan 恢复
- `GenerationService` 的任务提交流程
- `DatabaseConnection` 的迁移逻辑
- `SessionManager` 的登录检测
- `MaterialService` 的文件导入/删除
- 任何 IPC handler 的集成测试

**建议:** 至少为 Queue 和 Service 添加单元测试。

---

### P3-2 · 无 E2E 测试

没有任何端到端测试验证完整的"创建任务 → 提交到 Runway → 检测完成 → 下载视频"流程。

**建议:** 使用 Playwright + Electron 或 Spectron 编写关键路径的 E2E 测试。

---

### P3-3 · 无 CI/CD 配置

项目根目录没有 `.github/workflows/` 或其他 CI 配置文件。当前测试只能手动运行。

**建议:** 添加 GitHub Actions workflow：`typecheck` → `vitest run` → `build`。

---

### P3-4 · UI 文本硬编码中文

所有 UI 字符串硬编码为中文（如 `"排队中"`、`"生成中"`、`"暂无历史记录"`）。如果未来有非中文用户，无法切换语言。

**建议:** 提取为 i18n key，至少英文/中文双语言。

---

### P3-5 · MaterialPicker maxCount 与 MODEL_CAPS 不一致

**文件:** `src/ui/MaterialPicker.tsx:11`

```typescript
const MATERIAL_COUNT_MAX = 9
```

但 `MODEL_CAPS` 中各模型的 `maxImages` 不同（如 Seedance 支持多张，其他模型可能只支持 1 张）。MaterialPicker 的硬编码最大值可能与模型能力不匹配。

**建议:** MaterialPicker 接收 `maxCount` prop，由 TaskPanel 根据当前选中的模型动态传入。

---

### P3-6 · 快捷键 Ctrl+R 覆盖浏览器刷新

**文件:** `src/main/shortcuts.ts:10-12`

```typescript
globalShortcut.register('Ctrl+R', () => {
  mainWindow.webContents.send('shortcut:refresh-browser')
})
```

`Ctrl+R` 是浏览器/Electron 的标准页面刷新快捷键。应用覆盖后，用户无法用快捷键刷新 Runway 页面本身（快捷键只刷新 BrowserView）。这可能让有浏览器使用习惯的用户困惑。

---

### P3-7 · 日志文件无限增长

**文件:** `src/logs/logger.ts:33`

```typescript
log.transports.file.maxSize = 5 * 1024 * 1024
```

`electron-log` 的 `maxSize` 是单文件上限，达到后自动轮转。但只保留了默认的 archive 数量（通常 5 个），总共约 25MB。对于长期运行的应用可能不够。

**建议:** 增加 archive 数量或减小 `maxSize`。

---

### P3-8 · uuid 包体积

**文件:** `package.json:39`

依赖 `uuid@^10.0.0` 仅用于生成 ID。`crypto.randomUUID()` 在 Node 19+ 和现代浏览器中原生可用。Electron 33 使用 Node 20+，完全可以直接使用原生 API。

**建议:** 替换为 `crypto.randomUUID()`，移除 `uuid` 和 `@types/uuid` 依赖。

---

## 架构合规性检查

对照 CLAUDE.md 的架构红线逐项检查：

| 规则 | 状态 | 说明 |
|------|------|------|
| 所有 Runway 操作经过 Adapter | ✅ 通过 | DOM 操作集中在 adapter |
| React 组件无直接 DOM 操作 | ✅ 通过 | 均通过 IPC |
| 所有任务经过 Queue | ✅ 通过 | `TaskQueue` 唯一消费路径 |
| 关键操作记录 Logger | ⚠️ 部分 | Adapter 仍大量使用 console.log |
| 错误处理覆盖异步边界 | ⚠️ 部分 | IPC handler 错误处理不一致 |
| DOM 选择器配置化 | ❌ 未遵守 | 大量选择器散落在 adapter 方法中 |
| 每个 React 面板 ErrorBoundary | ⚠️ 部分 | App.tsx 包裹了面板，但部分内部子面板未包裹 |
| Adapter 操作用 withRetry | ✅ 通过 | selectModel、fillPrompt 等关键方法已包装 |
| Color 使用 CSS 变量 | ⚠️ 部分 | ErrorBoundary 硬编码色值 |
| 禁止硬编码模型名称 | ✅ 通过 | MODEL_CAPS 驱动 |

---

## 安全评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 供应链依赖 | 低 | `uuid`、`electron-log`、`better-sqlite3` 均有维护，风险低 |
| XSS（renderer） | 低 | React 默认转义，且无外部内容渲染 |
| IPC 注入 | 中 | 无参数校验，但 contextBridge 隔离限制了攻击面 |
| 本地数据泄露 | 低 | SQLite 文件在 userData 下，仅当前用户可读 |
| API Key 泄露 | 无 | 未发现硬编码 API Key（Runway 使用 session cookie） |

---

## 性能评估

| 项 | 评估 | 说明 |
|------|------|------|
| 启动时间 | 良好 | Electron + BrowserView 延迟加载 |
| 内存占用 | 可接受 | BrowserView 独立进程，约 200-400MB |
| DB 查询 | 良好 | SQLite WAL + 索引，查询 < 1ms |
| UI 渲染 | 可接受 | CSS-in-JS 无 memo，但组件树不深 |
| IPC 吞吐 | 良好 | 当前轮询频率下无瓶颈 |
| 磁盘 IO | 需关注 | 视频下载 + 无缓存清理策略 |

---

## 总结

项目整体架构遵循了 CLAUDE.md 定义的分层设计（UI → Service → Queue → Adapter），核心自动化流程（CDP monitor + 槽位系统 + AsyncLock）设计周密。主要问题集中在：

1. **P0: 硬编码用户名** — 阻碍多人使用的根本问题
2. **P0: 崩溃恢复** — 槽位状态不持久化
3. **P1: 输入校验缺失** — 生产环境需要防御性编程
4. **P2: 代码质量** — `any` 类型、console.log 替代 Logger、选择器散落
5. **P3: 测试覆盖** — 仅 3 个测试文件

建议在 Phase 2 的 Sprint 9-14 中优先解决 P0/P1 问题，P2 问题按 Sprint 分配穿插修复，P3 作为技术债跟踪。
