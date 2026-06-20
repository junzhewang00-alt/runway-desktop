# CLEANUP REPORT — runway-desktop

**Date:** 2026-06-19
**Scope:** 全项目扫描 · 不修改代码

---

## 1. 死代码 / 未使用 API

### 1.1 Preload API 未使用（LOW 风险）

| API | 状态 |
|-----|------|
| `queue.updateStatus` | Preload 暴露，UI 从未调用。IPC handler 仍被 Queue 内部使用 |
| `session.clear` | Preload 暴露，UI 从未调用 |
| `history.getById` | Preload 暴露，UI 从未调用 |

**影响**: 3 个 preload 桥接函数从不被调用，增加 preload 体积约 10 行。

### 1.2 源文件使用状态

32 个源文件全部被引用，无孤立文件。

---

## 2. 重复文件

### 2.1 CLAUDE.md = AGENTS.md（LOW 风险）

```
diff: 仅第 1 行标题不同
  CLAUDE.md: "# CLAUDE.md — Claude 编码永久规则"
  AGENTS.md: "# AGENTS.md — Codex 编码永久规则"
```

**影响**: 两份 4323 字节的相同文件，维护时需同步修改。

---

## 3. 冗余文件

| 文件 | 大小 | 类型 | 建议 |
|------|------|------|------|
| `DAILY_REPORT_2026-06-18.md` | 85 行 | 日报 | 归档或删除 |
| `HANDOFF.md` | 75 行 | 会话交接 | 归档到 docs/ |

---

## 4. 依赖分析

### 4.1 可替换依赖

| 包 | 使用处 | 替代方案 |
|----|--------|---------|
| `uuid@^10.0.0` | 3 处 `v4()` | `crypto.randomUUID()` (Node 20+) |
| `@types/uuid@^10.0.0` | 类型 | 随 uuid 移除 |

**收益**: 减少 2 个依赖包。

### 4.2 依赖使用确认

| 包 | 状态 |
|----|------|
| better-sqlite3 | ✅ 活跃使用 |
| electron-log | ✅ 活跃使用 |
| react / react-dom | ✅ 活跃使用 |
| electron / electron-builder | ✅ 活跃使用 |
| vitest / @vitest/ui | ✅ 活跃使用 |
| @testing-library/* | ✅ 测试使用 |

无未使用依赖。

---

## 5. 大文件

| 文件 | 行数 | 级别 |
|------|------|------|
| `src/adapters/runway.adapter.ts` | 2,517 | 🔴 超大 |
| `src/ui/TaskPanel.tsx` | 995 | 🟡 大 |
| `src/ui/MaterialPicker.tsx` | 441 | 🟢 中 |
| `src/main/index.ts` | 400 | 🟢 中 |
| `src/ui/HistoryPanel.tsx` | 391 | 🟢 中 |

---

## 6. 重复代码

### 6.1 下拉菜单选择器（重复 5 次）

`[role="listbox"], [role="menu"], [class*="popover"]...` 在 adapter.ts 中重复 5 次。

**状态**: P2-11 已集中到 `runway.selectors.ts` 的 `dropdownContainer`，但 adapter 中仍有硬编码实例。

### 6.2 MaterialPicker ↔ MaterialPanel 拖放逻辑

两个文件各有一套 `(f => (f as File & { path?: string }).path)` 和图片扩展名过滤。

**状态**: 已在 #2 any-type 修复中统一类型，但逻辑仍重复。

---

## 7. 未使用 IPC 对应的 Preload API

以下 preload 桥接函数在 UI 中无调用者：

- `electronAPI.queue.updateStatus`
- `electronAPI.session.clear`
- `electronAPI.history.getById`

注: IPC handler 本身仍被后端使用（如 `updateStatus` 被 Queue 内部调用）。

---

## 8. 风险分级汇总

| 风险 | 项目 | 数量 |
|------|------|------|
| **LOW** | 重复项目规则文件 | 1 |
| **LOW** | 未使用 preload API（可移除） | 3 |
| **LOW** | uuid 可替换为 crypto.randomUUID() | 2 个依赖 |
| **LOW** | 过期文档 (DAILY_REPORT, HANDOFF) | 2 个文件 |
| **MEDIUM** | 超大文件需拆分 | 2 个 |
| **MEDIUM** | 重复拖放逻辑 | 2 个组件 |

---

## 9. 安全区域（禁止触碰）

以下内容未被扫描/不会建议删除：
- ✅ 数据库逻辑 (better-sqlite3, connection.ts, stores)
- ✅ 认证/登录 (session.manager.ts)
- ✅ 支付系统 (无)
- ✅ 环境配置 (.env, tsconfig)
- ✅ 生产配置 (electron-builder)
