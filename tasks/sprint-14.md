# Sprint 14 — UX 优化

## TASK-014: 快捷键 + 通知 + 深色模式

**负责人**: Claude  
**优先级**: P2  
**依赖**: Sprint 8, 10, 13 完成

### 描述

打磨 UX 细节：快捷键、桌面通知、深色模式、键盘导航。

### 实现要求

#### 1. 全局快捷键

Electron `globalShortcut` 注册（仅在应用激活时）：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 聚焦 Prompt 输入框 |
| `Ctrl+R` | 刷新 BrowserView |
| `Ctrl+Shift+I` | 打开 Runway DevTools |
| `Ctrl+E` | 导出日志 |
| `Ctrl+1/2/3` | 切换到面板 1/2/3 |
| `Escape` | 关闭弹窗 |

```typescript
// src/main/shortcuts.ts
import { globalShortcut } from 'electron';

export function registerShortcuts(mainWindow: BrowserWindow) {
  globalShortcut.register('Ctrl+N', () => {
    mainWindow.webContents.send('shortcut:focus-prompt');
  });
  // ...
}
```

#### 2. 桌面通知增强

在 `src/services/notification.service.ts` 中统一管理：

- 生成完成通知
- 生成失败通知
- 下载完成通知
- 队列清空通知

```typescript
interface INotificationService {
  notify(title: string, body: string): void;
  notifyTaskComplete(taskId: string, videoUrl?: string): void;
  notifyTaskFailed(taskId: string, error: string): void;
  notifyQueueEmpty(): void;
}
```

#### 3. 深色/浅色主题

- 创建 `src/renderer/theme.css` — CSS 变量定义
- `App.tsx` 中添加主题切换按钮（右上角）
- 主题偏好存储到 localStorage
- 切换时更新 `<html data-theme="dark|light">`

```css
:root, [data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #1e1e1e;
  --text-secondary: #666666;
  --border-color: #e0e0e0;
  --accent: #0066ff;
}

[data-theme="dark"] {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2d2d2d;
  --text-primary: #e0e0e0;
  --text-secondary: #999999;
  --border-color: #404040;
  --accent: #3399ff;
}
```

#### 4. 面板折叠

- 每个面板添加折叠/展开按钮
- `App.tsx` 维护 `collapsed` 状态
- 折叠后面板宽度为 40px（只显示标签）
- `localStorage` 持久化折叠状态

#### 5. 键盘导航

- `Tab` 在输入框之间切换
- `Enter` 提交 Prompt（在输入框中时）
- 任务列表支持上下箭头选择
- `Delete` 删除选中的任务

### 验收标准

- [ ] Ctrl+N 聚焦到 Prompt 输入框
- [ ] 任务完成/失败弹出 Windows 通知
- [ ] 主题切换按钮可切换深色/浅色
- [ ] 主题偏好重启后保持
- [ ] 面板可折叠，折叠状态持久化
- [ ] Enter 可提交 Prompt

### Claude 实现指令

```
实现 Sprint 14: UX 优化

要求：
1. 快捷键
   - 创建 src/main/shortcuts.ts
   - Ctrl+N → 聚焦 prompt 输入（通过 IPC send）
   - Ctrl+R → 刷新 BrowserView
   - Ctrl+Shift+I → 打开 DevTools
   - Escape → 关闭弹窗
   - 在 app.whenReady 后注册，app.on('will-quit') 注销

2. 通知
   - 创建 src/services/notification.service.ts
   - 封装 Electron Notification API
   - 在 GenerationService 和 DownloadManager 中集成
   - 通知权限检查

3. 深色模式
   - 创建 src/renderer/theme.css，定义 CSS 变量
   - 全局替换硬编码颜色为 CSS 变量（TaskPanel, LogPanel, BrowserPanel, App）
   - App.tsx 右上角添加主题切换图标按钮
   - <html> 上设置 data-theme
   - localStorage 存储偏好

4. 面板折叠
   - App.tsx 中每个面板左侧添加折叠按钮
   - 折叠 = 40px 宽，只显示竖排文字或图标
   - localStorage 记录折叠状态

5. 键盘操作
   - TaskPanel 中 Enter 提交
   - 弹窗中 Escape 关闭

注意：
- CSS 变量要覆盖所有现有硬编码颜色
- 快捷键仅在应用聚焦时生效
- 通知需要 Windows 通知权限，未授权时静默失败
```
