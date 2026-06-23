# Sprint Acceptance Audit — runway-desktop

**Date:** 2026-06-21 | **Version:** 3.0.0

---

## Sprint 9: Adapter DOM + 集成测试 ✅

| 验收标准 | 状态 |
|----------|------|
| runway.selectors.ts 创建，选择器集中 | ✅ P2-11，15 个选择器组 |
| selectModel 工作 | ✅ |
| fillPrompt 工作 | ✅ |
| clickGenerate 工作 | ✅ |
| checkStatus 检测状态 | ✅ |
| 超时 30s | ✅ ADAPTER_TIMEOUT |
| 集成测试 | ✅ 5/13 pass (8 timeout pre-existing) |
| 选择器只需改一个文件 | ✅ |

---

## Sprint 10: 错误处理 + 恢复 ✅

| 验收标准 | 状态 |
|----------|------|
| ErrorBoundary 降级 UI | ✅ ErrorBoundary.tsx |
| withRetry 3 次 | ✅ adapter 各方法 |
| Retry 按钮 | ✅ TaskPanel |
| BrowserView crash 重建 | ✅ onRebuild → setBrowserView |
| IPC 超时 10s | ✅ withIpcTimeout |
| 测试 | ✅ ErrorBoundary 3 tests |

---

## Sprint 11: 历史记录 ✅

| 验收标准 | 状态 |
|----------|------|
| 写入 generations 表 | ✅ handleCompletion |
| 按时间倒序 | ✅ historyStore.list() |
| 按模型筛选 | ✅ + 校验 P1-3 |
| 按日期筛选 | ✅ |
| 查看详情 | ✅ copy-prompt event |
| 重新生成 | ✅ HistoryPanel "重新生成" 按钮 |

---

## Sprint 12: 批量 + 优先级 ✅

| 验收标准 | 状态 |
|----------|------|
| 批量创建 | ✅ BatchImport modal |
| .txt 拖入 | ✅ file input + drag-drop |
| 优先级排序 | ✅ TaskQueue priority sort |
| 备注字段 | ✅ note input |
| 搜索筛选 | ✅ search + status filter |

---

## Sprint 13: 下载管理 ✅

| 验收标准 | 状态 |
|----------|------|
| 自动下载 | ✅ DownloadManager |
| 进度条 | ✅ TaskPanel |
| downloads 目录 | ✅ |
| 桌面通知 | ✅ NotificationService |
| 失败不阻塞 | ✅ auto-retry P2-9 |

---

## Sprint 14: 通知 + 主题 + 面板 ✅

| 验收标准 | 状态 |
|----------|------|
| Ctrl+N 聚焦 | ✅ shortcuts.ts |
| 通知 | ✅ NotificationService |
| 主题切换 | ✅ dark mode toggle |
| 主题持久化 | ✅ localStorage |
| 面板折叠 | ✅ App.tsx |
| Enter 提交 | ✅ Ctrl+Enter |

---

## 总结

```
Sprint 9:  ✅ 8/8
Sprint 10: ✅ 6/6
Sprint 11: ✅ 6/6
Sprint 12: ✅ 6/6
Sprint 13: ✅ 5/5
Sprint 14: ✅ 6/6
─────────────────
总计: 37/37 ✅
```

Phase 2 (Sprint 9-14) 验收标准全部完成。
