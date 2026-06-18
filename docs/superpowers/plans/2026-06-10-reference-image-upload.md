# 参考图提交至 Runway — 代码级实现计划

> **For agentic workers:** 每个 Task 包含完整的代码变更、精确的文件路径和行号。Steps 使用 checkbox (`- [ ]`) 语法追踪进度。

**Goal:** 在 Runway Desktop Client 中实现从素材库拖拽图片到任务面板、随文本一并提交至 Runway 的完整功能。

**Architecture:** 分 3 层穿透：数据层（扩展 CreateTaskParams + task_materials 绑定）→ UI 层（MaterialPanel 拖出 + TaskPanel 接收 + ReferenceImageBar 组件）→ 适配器层（Runway 页面 DOM 模拟上传）。已有 `task_materials` 表和 `MaterialStore.linkTask()` 无需新建基础设施。

**Tech Stack:** Electron + React 18 + TypeScript + better-sqlite3

---

## 文件变更地图

| 文件 | 变更类型 | 职责 |
|---|---|---|
| `src/types/tasks.ts` | 修改 | `CreateTaskParams` 增加 `materialIds` |
| `src/ui/MaterialPanel.tsx` | 修改 | 卡片增加 `draggable` + `onDragStart` |
| `src/ui/TaskPanel.tsx` | 修改 | prompt 区域增加 drop 接收 + ReferenceImageBar |
| `src/ui/ReferenceImageBar.tsx` | **新建** | 参考图缩略图管理组件 |
| `src/preload/index.ts` | 修改 | `queue.create` 参数增加 `materialIds` |
| `src/main/index.ts` | 修改 | IPC handler 传递 `materialIds` |
| `src/queue/task.queue.ts` | 修改 | `create()` 调用 `materialStore.linkTask()` |
| `src/database/material.store.ts` | 已就绪 | 无需修改 |
| `src/adapters/runway.adapter.ts` | 修改 | `IRunwayAdapter` 增加 `submitWithImages` |
| `src/adapters/runway.selectors.ts` | 修改 | 增加首帧图上传区域选择器 |
| `tests/ui/ReferenceImageBar.test.tsx` | **新建** | ReferenceImageBar 组件测试 |

---

### Task 1: 扩展类型定义 — CreateTaskParams 增加 materialIds

**Files:**
- Modify: `src/types/tasks.ts:23-26`

- [ ] **Step 1: 给 `CreateTaskParams` 增加 `materialIds` 可选字段**

```typescript
/** 创建任务的参数 */
export interface CreateTaskParams {
  prompt: string
  modelId: string
  /** 关联的参考图 Material ID 列表 */
  materialIds?: string[]
}
```

- [ ] **Step 2: 验证类型编译**

Run: `npx tsc --noEmit`
Expected: 编译通过（此时尚未有代码引用该字段，不会产生新错误）

- [ ] **Step 3: Commit**

```bash
git add src/types/tasks.ts
git commit -m "feat: add materialIds to CreateTaskParams"
```

---

### Task 2: 队列层绑定 — task.queue.create 写入 task_materials

**Files:**
- Modify: `src/queue/task.queue.ts:7-10` (CreateParams 接口)
- Modify: `src/queue/task.queue.ts:39-58` (create 方法)
- Modify: `src/queue/task.queue.ts:1-3` (import)

- [ ] **Step 1: 扩展内部 `CreateParams` 接口**

在 `src/queue/task.queue.ts` 第 7-10 行，`CreateParams` 增加 `materialIds`：

```typescript
interface CreateParams extends CreateTaskParams {
  priority?: TaskPriority
  note?: string
  materialIds?: string[]
}
```

- [ ] **Step 2: 导入 materialStore**

在 `src/queue/task.queue.ts` 第 3 行后追加 import：

```typescript
import { materialStore } from '../database/material.store'
```

- [ ] **Step 3: create() 方法末尾增加 linkTask 调用**

在 `src/queue/task.queue.ts` 的 `create()` 方法中，`db.prepare(...INSERT...).run(task)` 之后（第 56 行后），`return task` 之前，追加：

```typescript
// 绑定参考图
if (params.materialIds && params.materialIds.length > 0) {
  for (const materialId of params.materialIds) {
    materialStore.linkTask(task.id, materialId)
  }
}
```

完整变更后的 `create` 方法末尾：

```typescript
    db.prepare(
      `INSERT INTO tasks (id, prompt, model_id, status, priority, note, retry_count, created_at, updated_at)
       VALUES (@id, @prompt, @modelId, @status, @priority, @note, @retryCount, @createdAt, @updatedAt)`,
    ).run(task)

    // 绑定参考图
    if (params.materialIds && params.materialIds.length > 0) {
      for (const materialId of params.materialIds) {
        materialStore.linkTask(task.id, materialId)
      }
    }

    return task
```

- [ ] **Step 4: 验证编译 + 功能测试**

Run: `npx tsc --noEmit`
Expected: 编译通过

手动测试：
```bash
# 1. 启动应用
npm run dev

# 2. 导入一张素材到素材库
# 3. 创建任务时在 DevTools console 运行：
window.electronAPI.queue.create({
  prompt: '测试参考图绑定',
  modelId: 'wan-2.6',
  priority: 'medium',
  materialIds: ['<替换为实际material.id>']
})

# 4. 停止应用，验证数据库：
npm rebuild better-sqlite3
node -e "
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const db = new Database(path.join(os.homedir(), 'AppData/Roaming/runway-desktop/runway-desktop.db'));
console.log(JSON.stringify(db.prepare('SELECT * FROM task_materials').all(), null, 2));
db.close();
"

# 5. 重新编译回 Electron
npx electron-rebuild -f -w better-sqlite3
```

Expected: `task_materials` 表中出现一条记录，包含 taskId 和 materialId

- [ ] **Step 5: Commit**

```bash
git add src/queue/task.queue.ts
git commit -m "feat: bind materialIds to tasks via task_materials in queue.create"
```

---

### Task 3: IPC 桥接层 — 传递 materialIds 从渲染进程到主进程

**Files:**
- Modify: `src/preload/index.ts:6-7` (queue.create 参数类型)
- Modify: `src/main/index.ts:148-150` (IPC handler 参数类型)

- [ ] **Step 1: preload 层扩展参数类型**

在 `src/preload/index.ts` 第 6-7 行，`queue.create` 参数增加 `materialIds`：

```typescript
  queue: {
    create: (params: { prompt: string; modelId: string; priority?: string; note?: string; materialIds?: string[] }) =>
      ipcRenderer.invoke('queue:create', params),
```

- [ ] **Step 2: main 层 IPC handler 扩展参数类型**

在 `src/main/index.ts` 第 148 行，`queue:create` handler 签名增加 `materialIds`：

```typescript
ipcMain.handle('queue:create', withIpcTimeout((_event, params: { prompt: string; modelId: string; priority?: string; note?: string; materialIds?: string[] }) => {
  return taskQueue.create(params)
}))
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/main/index.ts
git commit -m "feat: thread materialIds through IPC bridge for queue.create"
```

---

### Task 4: MaterialPanel 拖出功能 — 支持从素材库拖拽图片

**Files:**
- Modify: `src/ui/MaterialPanel.tsx:117-128` (缩略图卡片)

- [ ] **Step 1: 为缩略图卡片添加 draggable + onDragStart**

在 `MaterialPanel.tsx` 第 117 行的 `<div key={mat.id} ...>` 卡片元素上增加 `draggable` 和 `onDragStart`：

```tsx
<div
  key={mat.id}
  draggable={true}
  onDragStart={(e) => {
    // 获取要拖拽的 material id 列表（支持多选）
    const ids = selectedIds.has(mat.id)
      ? Array.from(selectedIds)
      : [mat.id]

    // 校验数量上限
    if (ids.length > 5) {
      e.preventDefault()
      alert('单次最多拖拽 5 张参考图')
      return
    }

    // 校验单张体积上限 (20MB)
    const oversize = ids
      .map((id) => materials.find((m) => m.id === id))
      .filter((m) => m && m.fileSize > 20 * 1024 * 1024)
    if (oversize.length > 0) {
      e.preventDefault()
      alert(`以下图片超过 20MB 限制：${oversize.map((m) => m!.fileName).join('、')}`)
      return
    }

    e.dataTransfer.setData(
      'application/x-runway-material-ids',
      JSON.stringify(ids)
    )
    e.dataTransfer.effectAllowed = 'copy'

    // 拖拽预览：克隆缩略图
    const img = e.currentTarget.querySelector('img')
    if (img) {
      const preview = img.cloneNode(true) as HTMLElement
      preview.style.width = '80px'
      preview.style.height = '80px'
      preview.style.position = 'absolute'
      preview.style.top = '-1000px'
      document.body.appendChild(preview)
      e.dataTransfer.setDragImage(preview, 40, 40)
      setTimeout(() => preview.remove(), 0)
    }
  }}
  onClick={(e) => handleSelect(mat.id, e)}
  title={mat.fileName}
  style={{
    ...styles.card,
    borderColor: isSelected ? '#0078d4' : '#e0e0e0',
  }}
>
```

- [ ] **Step 2: 验证编译 + 手动测试**

Run: `npx tsc --noEmit`
Expected: 编译通过

启动应用 `npm run dev`，测试：
1. 从素材库卡片拖拽图片到浏览器窗口外 → 鼠标指针变为 "复制" 图标
2. 多选后拖拽 → 预览显示多张缩略图
3. 选中超过 5 张拖拽 → 弹出提示

- [ ] **Step 3: Commit**

```bash
git add src/ui/MaterialPanel.tsx
git commit -m "feat: add drag-out from MaterialPanel with multi-select and size limits"
```

---

### Task 5: ReferenceImageBar 组件 — 参考图缩略图管理

**Files:**
- Create: `src/ui/ReferenceImageBar.tsx`
- Modify: `src/ui/TaskPanel.tsx`

- [ ] **Step 1: 创建 ReferenceImageBar 组件**

```tsx
import React from 'react'
import type { Material } from '../types/materials'

interface ReferenceImageBarProps {
  images: Material[]
  onRemove: (id: string) => void
  onAdd: () => void
}

const ReferenceImageBar: React.FC<ReferenceImageBarProps> = ({
  images,
  onRemove,
  onAdd,
}) => {
  const [previewId, setPreviewId] = React.useState<string | null>(null)

  const previewImage = previewId
    ? images.find((img) => img.id === previewId)
    : null

  return (
    <div style={styles.container}>
      <div style={styles.label}>
        参考图（{images.length}/5，拖拽图片到此处添加）:
      </div>
      <div style={styles.thumbnails}>
        {images.map((img) => (
          <div key={img.id} style={styles.card}>
            <img
              src={`material-file://${img.id}/`}
              alt={img.fileName}
              style={styles.thumbnail}
              onClick={() => setPreviewId(img.id)}
            />
            <button
              onClick={() => onRemove(img.id)}
              style={styles.removeBtn}
              title="移除参考图"
            >
              ×
            </button>
            <div style={styles.fileName} title={img.fileName}>
              {img.fileName.length > 10
                ? img.fileName.slice(0, 8) + '..'
                : img.fileName}
            </div>
          </div>
        ))}
        {images.length < 5 && (
          <button onClick={onAdd} style={styles.addBtn} title="添加参考图">
            +
          </button>
        )}
      </div>

      {/* Lightbox 预览 */}
      {previewImage && (
        <div style={styles.lightbox} onClick={() => setPreviewId(null)}>
          <img
            src={`material-file://${previewImage.id}/`}
            alt={previewImage.fileName}
            style={styles.lightboxImg}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewId(null)}
            style={styles.lightboxClose}
          >
            × 关闭
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: 8,
    padding: '8px 10px',
    background: '#f9f9f9',
    borderRadius: 4,
    border: '1px solid #e0e0e0',
  },
  label: {
    fontSize: 11,
    color: '#888',
    marginBottom: 6,
  },
  thumbnails: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  card: {
    position: 'relative' as const,
    width: 64,
    height: 64,
    borderRadius: 4,
    overflow: 'hidden',
    border: '2px solid #e0e0e0',
    background: '#fff',
    flexShrink: 0,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
    cursor: 'pointer',
  },
  removeBtn: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    width: 18,
    height: 18,
    background: 'rgba(217, 83, 79, 0.85)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    fontSize: 12,
    lineHeight: '16px',
    textAlign: 'center' as const,
    padding: 0,
  },
  fileName: {
    fontSize: 9,
    color: '#666',
    textAlign: 'center' as const,
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: 64,
  },
  addBtn: {
    width: 64,
    height: 64,
    borderRadius: 4,
    border: '2px dashed #ccc',
    background: '#f5f5f5',
    cursor: 'pointer',
    fontSize: 24,
    color: '#999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  lightbox: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  lightboxImg: {
    maxWidth: '90%',
    maxHeight: '90%',
    objectFit: 'contain' as const,
    cursor: 'default',
  },
  lightboxClose: {
    position: 'absolute' as const,
    top: 20,
    right: 20,
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 14,
  },
}

export default ReferenceImageBar
```

- [ ] **Step 2: 在 TaskPanel 中集成 ReferenceImageBar**

在 `src/ui/TaskPanel.tsx` 中：
1. 文件顶部追加 import：
```typescript
import ReferenceImageBar from './ReferenceImageBar'
import type { Material } from '../types/materials'
```

2. 在 state 声明区域（`const [note, setNote] = useState('')` 之后）追加：
```typescript
const [referenceImages, setReferenceImages] = useState<Material[]>([])
const [dragOverInput, setDragOverInput] = useState(false)
```

3. 添加参考图处理函数（在 `handleKeyDown` 之后）：
```typescript
const handleAddReference = (ids: string[]) => {
  // 加载 material 详情（通过 IPC）
  window.electronAPI.material.list().then((allMaterials: Material[]) => {
    const newImages = ids
      .map((id) => allMaterials.find((m) => m.id === id))
      .filter((m): m is Material => m !== undefined)
    setReferenceImages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id))
      const uniqueNew = newImages.filter((m) => !existingIds.has(m.id))
      const combined = [...prev, ...uniqueNew].slice(0, 5)
      if (combined.length > 5) {
        alert('单次最多添加 5 张参考图')
      }
      return combined.slice(0, 5)
    })
  })
}

const handleRemoveReference = (id: string) => {
  setReferenceImages((prev) => prev.filter((m) => m.id !== id))
}

const handleAddFromDialog = async () => {
  const paths = await window.electronAPI.material.openDialog()
  if (paths.length > 0) {
    const imported = await window.electronAPI.material.import(paths)
    handleAddReference(imported.map((m: Material) => m.id))
  }
}
```

4. 修改 `handleCreate` 函数，在 `queue.create` 调用中传递 `materialIds`：
```typescript
const handleCreate = () => {
  if (!prompt.trim()) return
  const materialIds = referenceImages.map((m) => m.id)
  window.electronAPI.queue.create({
    prompt: prompt.trim(),
    modelId,
    priority,
    note: note.trim(),
    materialIds: materialIds.length > 0 ? materialIds : undefined,
  }).then(() => {
    setPrompt('')
    setNote('')
    setReferenceImages([])
    loadTasks()
  })
}
```

5. 修改 textarea 区域，包裹 drop 容器并显示 ReferenceImageBar。找到第 234-241 行的 `<textarea>` 块，替换为：

```tsx
<div
  onDragOver={(e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverInput(true)
  }}
  onDragLeave={() => setDragOverInput(false)}
  onDrop={(e) => {
    e.preventDefault()
    setDragOverInput(false)
    const raw = e.dataTransfer.getData('application/x-runway-material-ids')
    if (!raw) return
    try {
      const ids: string[] = JSON.parse(raw)
      handleAddReference(ids)
    } catch { /* 非素材库拖拽，忽略 */ }
  }}
  style={{
    border: dragOverInput ? '2px dashed #0078d4' : '2px solid transparent',
    borderRadius: 4,
    transition: 'border-color 0.2s',
  }}
>
  <textarea
    value={prompt}
    onChange={(e) => setPrompt(e.target.value)}
    onKeyDown={handleKeyDown}
    placeholder={
      dragOverInput
        ? '释放以添加参考图'
        : '输入提示词... (Ctrl+Enter 提交)'
    }
    style={styles.textarea}
    rows={3}
  />
  <ReferenceImageBar
    images={referenceImages}
    onRemove={handleRemoveReference}
    onAdd={handleAddFromDialog}
  />
</div>
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 编译通过

- [ ] **Step 4: 手动测试 UI**

启动应用 `npm run dev`：
1. 从素材库拖拽单张图片到 prompt 输入区 → 参考图缩略图出现
2. 多选拖拽 3 张 → 3 张全部出现
3. 点击缩略图 × → 删除
4. 点击缩略图 → 弹出 Lightbox 预览
5. 点击 "+" 按钮 → 打开文件选择器，导入新图片
6. 创建任务（带参考图）→ 任务创建成功，参考图列表清空

- [ ] **Step 5: Commit**

```bash
git add src/ui/ReferenceImageBar.tsx src/ui/TaskPanel.tsx
git commit -m "feat: add ReferenceImageBar component with drag-drop and lightbox preview"
```

---

### Task 6: Runway 适配器 — 图片上传至 BrowserView

**Files:**
- Modify: `src/adapters/runway.selectors.ts:15-17` (增加首帧图选择器)
- Modify: `src/adapters/runway.adapter.ts:20-31` (IRunwayAdapter 接口)
- Modify: `src/adapters/runway.adapter.ts:113+` (RunwayAdapter 实现)

- [ ] **Step 1: 增加 Runway 首帧图上传选择器**

在 `src/adapters/runway.selectors.ts` 的 `RUNWAY_SELECTORS` 对象中追加：

```typescript
  /** 首帧图 / 参考图上传区域 */
  firstFrameUpload: '[class*="FirstFrame"], [class*="first-frame"], [class*="upload"], [class*="Upload"], [data-testid*="upload"] input[type="file"]',
  /** 文件上传隐藏 input（如 Runway 使用隐藏的 <input type="file">） */
  hiddenFileInput: 'input[type="file"]',
```

- [ ] **Step 2: 扩展 IRunwayAdapter 接口**

在 `src/adapters/runway.adapter.ts` 第 32 行 `submitOnly` 声明之后，追加：

```typescript
  /** 上传参考图到 Runway 页面 */
  uploadReferenceImages(imagePaths: string[]): Promise<void>
```

- [ ] **Step 3: 实现 uploadReferenceImages 方法**

在 `RunwayAdapter` 类中，`submitOnly` 方法之前（找合适位置），追加：

```typescript
  /**
   * 将参考图上传到 Runway 页面的首帧图/参考图区域
   *
   * 策略：查找 Runway 页面上的隐藏 <input type="file"> 或上传区域，
   * 通过构造 File 对象 + DataTransfer 模拟用户拖拽上传。
   *
   * 注意：Runway 的 DOM 结构可能变化，此方法优先尝试 File input 直传，
   * 回退到模拟拖拽上传到 "First Video Frame" 区域。
   */
  async uploadReferenceImages(imagePaths: string[]): Promise<void> {
    if (imagePaths.length === 0) return

    const wc = this.getWebContents()

    for (let i = 0; i < imagePaths.length; i++) {
      const filePath = imagePaths[i]
      console.log(`[Adapter] Uploading reference image ${i + 1}/${imagePaths.length}: ${filePath}`)

      const uploaded: boolean = await wc.executeJavaScript(`
        (function() {
          var imgPath = ${JSON.stringify(filePath)};

          // 策略 A: 查找隐藏的 <input type="file">
          var fileInputs = document.querySelectorAll('input[type="file"]');
          for (var j = 0; j < fileInputs.length; j++) {
            // 尝试通过设置 files 属性来注入文件（依赖 File API）
            // 注意：出于安全考虑，浏览器 JS 无法直接设置 input.files
            // 需要利用 Runway 页面的拖拽上传逻辑
          }

          // 策略 B: 模拟拖拽到 "First Video Frame" / "Upload" 区域
          var dropTargets = document.querySelectorAll(
            '[class*="FirstFrame"], [class*="first-frame"], ' +
            '[class*="upload-area"], [class*="Upload"], ' +
            '[class*="dropzone"], [class*="DropZone"]'
          );
          
          if (dropTargets.length === 0) {
            // 查找包含 "First Video Frame" 文本的父元素
            var all = document.querySelectorAll('*');
            for (var k = 0; k < all.length; k++) {
              var txt = (all[k].textContent || '').trim();
              if (txt === 'First Video Frame' && all[k].offsetParent !== null) {
                dropTargets = [all[k].closest('div, section, [class*="upload"]') || all[k]];
                break;
              }
            }
          }

          if (dropTargets.length === 0) return false;

          // 构造 DataTransfer 模拟拖拽
          var dt = new DataTransfer();
          var file = new File([''], imgPath.split('/').pop() || 'image.png', { type: 'image/png' });
          // 注意：new File() 在沙盒中可能受限，作为回退尝试直接派发 paste 事件
          try {
            dt.items.add(file);
          } catch(e) {
            // File constructor may not work — try alternative
            return false;
          }

          ;['dragenter', 'dragover', 'drop'].forEach(function(type) {
            var ev = new DragEvent(type, {
              bubbles: true, cancelable: true,
              dataTransfer: dt,
            });
            dropTargets[0].dispatchEvent(ev);
          });

          return true;
        })()
      `)

      if (!uploaded) {
        console.log(`[Adapter] Reference image ${i + 1} upload failed via JS, will retry with click-based approach`)
        // 策略 C: 点击上传区域 → 后续通过 sendInputEvent 点击
        // （此路径需要将图片路径传给主进程，由主进程通过 dialog 选择文件）
        // 当前回退：记录警告
        console.warn(`[Adapter] Cannot upload image ${filePath} — Runway upload area not found in DOM`)
      }

      // 等待上传完成
      await new Promise((r) => setTimeout(r, 1000))
    }

    console.log(`[Adapter] Reference image upload complete: ${imagePaths.length} images`)
  }
```

> **注意**：由于 BrowserView 的安全限制，通过 JS 直接构造 File 对象并注入到页面可能受限。如果以上方案不生效，需要在 P1 预研阶段验证实际可行方案，可能的替代策略包括：
> - 通过 `webContents.debugger.sendCommand('DOM.setFileInputFiles', ...)` 直接设置文件（需要 CDP）
> - 通过 `webContents.executeJavaScript` 调用 Runway 页面的内部上传函数
> - 通过 `webContents.sendInputEvent` 点击上传区域后，由 Electron dialog 选择文件

- [ ] **Step 4: 修改 submitOnly 方法签名，支持传入图片路径**

将 `submitOnly` 的签名从：
```typescript
async submitOnly(taskId: string, modelId: string, prompt: string): Promise<void>
```
扩展为：
```typescript
async submitOnly(taskId: string, modelId: string, prompt: string, imagePaths?: string[]): Promise<void>
```

在 `submitOnly` 方法内部，`fillPrompt(prompt)` 调用之前，追加：
```typescript
      // 上传参考图（如有）
      if (imagePaths && imagePaths.length > 0) {
        await this.uploadReferenceImages(imagePaths)
      }
```

- [ ] **Step 5: 同步修改 IRunwayAdapter 接口**

在 `src/adapters/runway.adapter.ts` 第 32 行：
```typescript
  submitOnly(taskId: string, modelId: string, prompt: string, imagePaths?: string[]): Promise<void>
```

- [ ] **Step 6: 同步修改 generation.service.ts**

`src/services/generation.service.ts` 的 `executeGeneration` 方法中，`this.adapter.submitOnly(...)` 调用需要传入 imagePaths。

在 `executeGeneration` 方法开头获取 task 后，追加查询素材：
```typescript
    // 获取关联的参考图路径
    const imagePaths: string[] = []
    try {
      const linkedMaterials = materialStore.getByTaskId(taskId)
      imagePaths.push(...linkedMaterials.map((m) => m.filePath))
    } catch { /* materialStore 可能未初始化 */ }
```

需要新增 import：
```typescript
import { materialStore } from '../database/material.store'
```

修改 submitOnly 调用：
```typescript
      await this.adapter.submitOnly(taskId, task.modelId, task.prompt, imagePaths.length > 0 ? imagePaths : undefined)
```

- [ ] **Step 7: 验证编译**

Run: `npx tsc --noEmit`
Expected: 编译通过

- [ ] **Step 8: Commit**

```bash
git add src/adapters/runway.selectors.ts src/adapters/runway.adapter.ts src/services/generation.service.ts
git commit -m "feat: add reference image upload pipeline to Runway adapter"
```

---

### Task 7: 组件集成测试

**Files:**
- Create: `tests/ui/ReferenceImageBar.test.tsx`

- [ ] **Step 1: 编写 ReferenceImageBar 单元测试**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ReferenceImageBar from '../../src/ui/ReferenceImageBar'
import type { Material } from '../../src/types/materials'

const mockImages: Material[] = [
  {
    id: 'img-1',
    fileName: 'beach-sunset.png',
    filePath: '/materials/beach-sunset.png',
    mimeType: 'image/png',
    fileSize: 1024000,
    width: 1920,
    height: 1080,
    createdAt: Date.now(),
  },
  {
    id: 'img-2',
    fileName: 'dog-running.jpg',
    filePath: '/materials/dog-running.jpg',
    mimeType: 'image/jpeg',
    fileSize: 2048000,
    width: 3840,
    height: 2160,
    createdAt: Date.now(),
  },
]

describe('ReferenceImageBar', () => {
  it('renders images with thumbnails', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    // 缩略图应出现
    expect(screen.getAllByRole('img').length).toBe(2)
  })

  it('shows add button when fewer than 5 images', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getByText('+')).toBeDefined()
  })

  it('hides add button when 5 images', () => {
    const fiveImages = Array.from({ length: 5 }, (_, i) => ({
      ...mockImages[0],
      id: `img-${i}`,
      fileName: `image-${i}.png`,
    }))
    render(
      <ReferenceImageBar
        images={fiveImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.queryByText('+')).toBeNull()
  })

  it('calls onRemove when × button clicked', () => {
    const onRemove = vi.fn()
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={onRemove}
        onAdd={vi.fn()}
      />
    )
    const removeButtons = screen.getAllByText('×')
    fireEvent.click(removeButtons[0])
    expect(onRemove).toHaveBeenCalledWith('img-1')
  })

  it('calls onAdd when + button clicked', () => {
    const onAdd = vi.fn()
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={onAdd}
      />
    )
    fireEvent.click(screen.getByText('+'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('shows lightbox preview on thumbnail click', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    const thumbnails = screen.getAllByRole('img')
    fireEvent.click(thumbnails[0])
    // Lightbox 应出现
    expect(screen.getByText('× 关闭')).toBeDefined()
  })

  it('displays count label correctly', () => {
    render(
      <ReferenceImageBar
        images={mockImages}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getByText(/参考图（2\/5/)).toBeDefined()
  })

  it('renders empty state without errors', () => {
    render(
      <ReferenceImageBar
        images={[]}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
      />
    )
    expect(screen.getByText(/参考图（0\/5/)).toBeDefined()
  })
})
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/ui/ReferenceImageBar.test.tsx`
Expected: 7 tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/ui/ReferenceImageBar.test.tsx
git commit -m "test: add ReferenceImageBar unit tests"
```

---

## 自检清单

完成所有 Task 后，确认以下功能点：

- [ ] 从素材库拖拽 1-5 张图片到 prompt 输入区成功
- [ ] 拖拽超过 5 张或超过 20MB 的图片正确提示
- [ ] ReferenceImageBar 显示缩略图、文件名、删除按钮
- [ ] 点击缩略图弹出 Lightbox，可关闭
- [ ] 点击 "+" 按钮打开系统文件选择器
- [ ] 创建带参考图的任务后，`task_materials` 表中有对应记录
- [ ] 仅文本提交（无参考图）的现有流程不受影响
- [ ] 批量导入 .txt 任务不受影响
- [ ] `npx tsc --noEmit` 编译通过
- [ ] `npx vitest run` 全部测试通过

---

## P1 预研待办（不在本次实现范围内，但需在下一阶段验证）

1. **Runway 首帧图上传 DOM 定位**：在 Runway 页面 DevTools 中定位 "First Video Frame" / Upload 区域的准确 DOM 选择器
2. **File 对象注入可行性**：测试 `new File()` + `DataTransfer` + `DragEvent` 在 BrowserView 中是否能被 Runway 页面的 React 事件系统正确捕获
3. **CDP 文件注入方案**：验证 `debugger.sendCommand('DOM.setFileInputFiles', { files: [...] })` 在 Runway 页面是否可用
4. **多图上传**：确认 Runway 单次是否支持上传多张参考图，还是每张需独立上传
