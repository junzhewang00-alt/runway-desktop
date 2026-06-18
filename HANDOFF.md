# Runway Desktop — 当前状态 (2026-06-10)

## 架构：并发提交模型

```
Queue.workerLoop
  → hasSlot()? → 取 pending task → mark running
  → generationService.executeGeneration(taskId)
    → adapter.submitOnly(taskId, modelId, prompt)
      → [LOCK] resetPage → selectModel → fillPrompt → clickGenerate → [UNLOCK]
      → slotOccupied[0或1] = true, submittedTasks.set(taskId, {slot, submittedAt})
    → return (不等待完成)

[CDP Monitor 持久运行]
  → 拦截 Network.responseReceived
  → 信号1: 视频 .mp4 加载 → handleMonitorCompletion(videoUrl)
  → 信号2: API status=succeeded → handleMonitorCompletion(videoUrl)
  → 3秒冷却去重 → matchCompletionToTask() → onComplete → onSlotFreed
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/adapters/runway.adapter.ts` | 核心：submitOnly、CDP monitor、槽位匹配、页面交互 |
| `src/adapters/runway.selectors.ts` | DOM 选择器常量 + JS 工具函数 |
| `src/services/generation.service.ts` | executeGeneration + handleCompletion 回调 |
| `src/queue/task.queue.ts` | 槽位感知 worker loop + 孤儿任务清理 |
| `src/main/index.ts` | DI 编排：回调注册→monitor启动→队列启动 |

## Adapter 关键状态

```
pageReady: boolean        — 页面是否需要 resetPage
currentModel: string      — 当前选中的模型，跳过重复切换
runwaySlots: 0-2          — 当前活跃生成数
slotOccupied: [bool,bool] — 每个槽位占用状态
submittedTasks: Map<taskId, {slot, submittedAt}>
lastCompletionTime: number — CDP 去重冷却时间戳 (3s)
monitorActive: boolean    — CDP 是否已 attach
```

## 已修复的 Bug（本次会话）

1. **resetPage reload 后缺 waitForReady** — 导致任务2+ fillPrompt 失败
2. **CDP 双重事件假匹配** — 同一生成触发视频+API两事件，FIFO匹配到两个不同任务。加了3秒冷却去重
3. **FIFO 完成匹配** — 改为槽位分配 + UI 探测回退
4. **孤儿 running 任务** — 重启时自动标记为 failed

## 已知风险

1. **CDP 完成检测**：依赖 URL 模式 `/generation|task|asset|output|job/i`，Runway API 变更可能漏检
2. **matchCompletionToTask UI 探测**：2个并发任务时查 DOM 判断哪个完成，可能不准确，回退 FIFO
3. **Session 配置**：首次使用需选文件夹，"Select where your generations will be saved" 处理较脆弱
4. **clickGenerate 无验证**：OS click + JS click 双发后信任点击，不检查是否真的开始生成
5. **页面每次 reload**：任务间 resetPage 会 reload 整个页面（~15s），因为 Runway 单页面无法软重置

## 测试方式

```bash
npm run dev                          # 启动
node test_inject.mjs                 # 注入测试任务（4个）
# 观察：任务1-2应几乎同时提交，任务3-4排队
# CDP完成检测应触发 handleCompletion 回调
# 日志：%APPDATA%/runway-desktop/logs/runway-desktop.log
```
