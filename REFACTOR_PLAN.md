# REFACTOR PLAN — runway-desktop

**Date:** 2026-06-19
**Status:** 等待人工确认 · 不执行

---

## 1. 最大文件

| 排名 | 文件 | 行数 | 问题 |
|------|------|------|------|
| 1 | `src/adapters/runway.adapter.ts` | 2,517 | 超过合理上限 5×。含 CDP 协议、DOM 操作、锁管理、monitor、上传 5 种职责 |
| 2 | `src/ui/TaskPanel.tsx` | 995 | 创建表单 + 批量导入 + 模型选择 + 参数配置 + 任务列表 + 搜索 + 筛选 混杂 |
| 3 | `src/ui/MaterialPicker.tsx` | 441 | 素材选择器，含拖放、筛选、预览 |
| 4 | `src/main/index.ts` | 400 | 21 个 IPC handler + 窗口创建 + 依赖注入编排 |

---

## 2. 最复杂模块

| 模块 | 复杂度 | 原因 |
|------|--------|------|
| `RunwayAdapter` | 🔴 极高 | 5 种职责混杂，2500 行单体类 |
| `TaskPanel` | 🟡 高 | 7 种 UI 职责，状态管理混乱 |
| `GenerationService` | 🟡 中 | 任务执行 + 下载委托 + 历史记录 + 通知，已部分解耦 |
| `TaskQueue` | 🟢 中 | 队列管理 + 槽位恢复 + 优先级排序，职责相对清晰 |

---

## 3. 重复代码

| 模式 | 文件 | 重复次数 |
|------|------|----------|
| 下拉菜单选择器逻辑 | `runway.adapter.ts` | 5 处（已集中到 selectors，adapter 待迁移） |
| 拖放文件处理 (扩展名过滤 + path 提取) | `MaterialPicker.tsx`, `MaterialPanel.tsx` | 2 处 |
| `withRetry` 包装模式 | `runway.adapter.ts` | ~8 处各方法 |

---

## 4. 按收益排序

### 🔴 P0 — 最高收益

**1. 拆分 runway.adapter.ts（预计减少 60% 复杂度）**
- 拆为: `RunwayDomAdapter`, `CdpMonitor`, `SlotManager`, `LockManager`
- 收益: 每个模块 <500 行，可独立测试
- 风险: 高（需保留现有接口兼容）

### 🟡 P1 — 高收益

**2. 拆分 TaskPanel.tsx（预计提升可维护性 3×）**
- 拆为: `TaskForm`, `TaskList`, `ModelSelector`, `ParameterPanel`, `BatchImportModal`
- 收益: 每个组件 <200 行，职责单一
- 风险: 中（需提取共享状态）

**3. 提取共享拖放 Hook（消除重复）**
- 新建: `src/ui/hooks/useFileDrop.ts`
- 收益: MaterialPicker 和 MaterialPanel 共享逻辑
- 风险: 低

### 🟢 P2 — 中等收益

**4. adapter 选择器引用迁移**
- 将 adapter 中 5 处硬编码下拉选择器替换为 `RUNWAY_SELECTORS.dropdownContainer`
- 收益: Runway 改版时只改一个文件
- 风险: 极低

**5. main/index.ts IPC handler 分组**
- 按领域拆为: `ipc-browser.ts`, `ipc-queue.ts`, `ipc-material.ts`
- 收益: 每个文件 <100 行
- 风险: 低

---

## 5. 注意事项

- 所有重构必须在测试通过后进行
- adapter 拆分需保留 `IRunwayAdapter` 接口不变
- 禁止修改数据库逻辑、session 逻辑
- 禁止修改环境变量和构建配置
