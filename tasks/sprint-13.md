# Sprint 13 — 自动下载

## TASK-013: 生成完成自动下载视频

**负责人**: Claude  
**优先级**: P1  
**依赖**: Sprint 9, 11 完成

### 描述

视频生成完成后自动下载到本地目录，显示进度，完成后通知。

### 实现要求

#### 1. 下载管理器

创建 `src/download/download.manager.ts`：

```typescript
interface IDownloadManager {
  download(url: string, taskId: string): Promise<string>; // 返回本地路径
  getDownloadDir(): string;
  getProgress(taskId: string): DownloadProgress | null;
}

interface DownloadProgress {
  taskId: string;
  url: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'downloading' | 'completed' | 'cancelled' | 'interrupted';
}
```

#### 2. 使用 Electron downloadItem API

```typescript
// 在主进程中
const win = BrowserWindow.getAllWindows()[0];
win.webContents.session.on('will-download', (event, item) => {
  item.setSavePath(path.join(downloadDir, filename));
  
  item.on('updated', (event, state) => {
    // 推送进度到渲染进程
    emitProgress(taskId, item.getReceivedBytes(), item.getTotalBytes());
  });
  
  item.on('done', (event, state) => {
    // 下载完成
    emitComplete(taskId, item.getSavePath());
  });
});
```

#### 3. 集成到生成流程

- `GenerationService.executeGeneration()` 在 `waitForCompletion()` 成功后：
  1. 从 `result.videoUrl` 获取视频链接
  2. 调用 `DownloadManager.download(videoUrl, taskId)`
  3. 更新 Task 状态为 `downloading`
  4. 下载完成后更新为 `completed`

#### 4. UI 进度显示

- `TaskPanel` 中 running/downloading 状态的任务显示进度条
- 下载目录设置为 `<userData>/downloads/`
- 下载完成后 Task 状态变为 `completed`，显示本地路径

#### 5. 桌面通知

- 下载完成后使用 `Notification` API 弹出 Windows 通知
- 通知内容: "Runway Desktop — 视频已下载: {文件名}"

### 验收标准

- [ ] 视频生成后自动触发下载
- [ ] TaskPanel 中显示下载进度条
- [ ] 下载到 `<userData>/downloads/` 目录
- [ ] 下载完成弹出 Windows 桌面通知
- [ ] 下载失败不阻塞队列继续消费

### Claude 实现指令

```
实现 Sprint 13: 自动下载

要求：
1. 创建 src/download/download.manager.ts
   - 使用 Electron session 的 will-download 事件
   - setSavePath 设置保存路径
   - 监听 updated / done 事件推送进度
   - 单例模式

2. 下载目录
   - 默认: app.getPath('userData') + '/downloads'
   - 启动时确保目录存在

3. 集成到生成流程
   - src/services/generation.service.ts
   - waitForCompletion() 成功后 → downloadManager.download(videoUrl, taskId)
   - Task 状态新增 'downloading'
   - 下载完成 → 'completed'

4. UI 进度
   - src/ui/TaskPanel.tsx: running/downloaing 状态任务显示进度条
   - 通过 IPC 获取下载进度: download:getProgress
   - 完成显示绿色标记和本地路径 tooltip

5. 桌面通知
   - 主进程使用 new Notification({ title, body })
   - 仅在下载完成时弹一次

注意：
- will-download 是 session 级事件，只需要注册一次
- 下载失败不抛异常，记录日志，任务保持 completed（视频 URL 仍可用）
```
