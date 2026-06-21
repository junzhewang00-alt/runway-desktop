import { useEffect, useState, useRef } from 'react'
import type { Task, TaskStatus, TaskPriority } from '../types/tasks'
import { MODEL_CAPS } from '../types/models'
import type { ModelCapability } from '../types/models'
import ReferenceImageBar from './ReferenceImageBar'
import MaterialPicker from './MaterialPicker'
import type { Material } from '../types/materials'

const STATUS_LABELS: TaskStatus[] = ['pending', 'running', 'completed', 'failed']

const statusLabelMap: Record<TaskStatus, string> = {
  pending: '待处理',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
}

const priorityLabelMap: Record<TaskPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const priorityColor: Record<TaskPriority, string> = {
  high: 'var(--color-danger)',
  medium: 'var(--color-warning)',
  low: 'var(--color-text-muted)',
}

const TaskPanel: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([])
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('gen-4.5')
  const [models, setModels] = useState<ModelCapability[]>([])
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [note, setNote] = useState('')
  const [referenceImages, setReferenceImages] = useState<Material[]>([])
  const [showMaterialPicker, setShowMaterialPicker] = useState(false)
  const [dragOverInput, setDragOverInput] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // 视频配置
  const [duration, setDuration] = useState(5)
  const [resolution, setResolution] = useState('720p')
  const [aspectRatio, setAspectRatio] = useState('16:9')

  // 搜索 & 过滤
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null)

  // 批量导入
  const [showBatch, setShowBatch] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchModel, setBatchModel] = useState('wan-2.6')
  const [batchDuration, setBatchDuration] = useState(5)
  const [batchResolution, setBatchResolution] = useState('720p')
  const [batchAspectRatio, setBatchAspectRatio] = useState('16:9')
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadTasks = () => {
    window.electronAPI.queue.list().then((list) => {
      setTasks(list)
      if (list.some((t) => t.status === 'running')) {
        startPolling()
      } else if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    })
  }

  const loadModels = () => {
    window.electronAPI.models.list().then((list: ModelCapability[]) => {
      setModels(list)
      // 初始化默认模型的配置
      const cap = list.find((m) => m.id === modelId)
      if (cap) {
        setDuration(cap.defaultDuration)
        setResolution(cap.defaultResolution)
        setAspectRatio(cap.defaultAspectRatio)
      }
    })
  }

  /** 模型切换时联动更新时长/分辨率/比例选项 */
  const handleModelChange = (newModelId: string) => {
    setModelId(newModelId)
    const cap = MODEL_CAPS[newModelId]
    if (cap) {
      setDuration(cap.defaultDuration)
      setResolution(cap.defaultResolution)
      setAspectRatio(cap.defaultAspectRatio)
    }
  }

  const currentCaps = MODEL_CAPS[modelId]

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = () => {
    if (pollRef.current) return
    pollRef.current = setInterval(loadTasks, 5000)
  }

  useEffect(() => {
    loadTasks()
    loadModels()
    startPolling()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // 监听全局快捷键
  useEffect(() => {
    return window.electronAPI.shortcuts.onFocusPrompt(() => {
      promptRef.current?.focus()
    })
  }, [])

  // 监听来自 HistoryPanel 的 "复制提示词" 事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        prompt: string
        modelId: string
        duration?: number
        resolution?: string
        aspectRatio?: string
      }
      setPrompt(detail.prompt)
      if (detail.modelId) {
        handleModelChange(detail.modelId)
      }
      if (detail.duration !== undefined) setDuration(detail.duration)
      if (detail.resolution) setResolution(detail.resolution)
      if (detail.aspectRatio) setAspectRatio(detail.aspectRatio)
    }
    window.addEventListener('copy-prompt', handler)
    return () => window.removeEventListener('copy-prompt', handler)
  }, [])

  const handleCreate = () => {
    if (!prompt.trim()) return
    const materialIds = referenceImages.map((m) => m.id)
    window.electronAPI.queue.create({
      prompt: prompt.trim(),
      modelId,
      priority,
      note: note.trim(),
      materialIds: materialIds.length > 0 ? materialIds : undefined,
      duration,
      resolution,
      aspectRatio,
    }).then(() => {
      setPrompt('')
      setNote('')
      setReferenceImages([])
      startPolling()
      loadTasks()
    })
  }

  const handleDelete = (id: string) => {
    window.electronAPI.queue.delete(id).then(loadTasks)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) handleCreate()
  }

  const handleAddReference = (ids: string[]) => {
    // 加载 material 详情（通过 IPC）
    window.electronAPI.material.list().then((allMaterials: Material[]) => {
      const newImages = ids
        .map((id) => allMaterials.find((m) => m.id === id))
        .filter((m): m is Material => m !== undefined)
      setReferenceImages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        const seen = new Set<string>()
        const uniqueNew = newImages.filter((m) => {
          if (existingIds.has(m.id) || seen.has(m.id)) return false
          seen.add(m.id)
          return true
        })
        const combined = [...prev, ...uniqueNew]
        const limit = currentCaps?.maxImages ?? 5
        if (combined.length > limit) {
          alert(`单次最多添加 ${limit} 张参考图`)
        }
        return combined.slice(0, limit)
      })
    })
  }

  const handleRemoveReference = (id: string) => {
    setReferenceImages((prev) => prev.filter((m) => m.id !== id))
  }

  const handlePickerSelection = (ids: string[]) => {
    handleAddReference(ids)
    setShowMaterialPicker(false)
  }

  const selectedMaterialIds = new Set(referenceImages.map((m) => m.id))

  const handleAddFromDialog = async () => {
    const paths = await window.electronAPI.material.openDialog()
    if (paths.length > 0) {
      const imported = await window.electronAPI.material.import(paths)
      handleAddReference(imported.map((m: Material) => m.id))
    }
  }

  // 批量导入
  const handleBatchImport = async () => {
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    if (lines.length === 0) return

    setBatchProgress({ current: 0, total: lines.length })

    const CONCURRENCY = 5
    let completed = 0
    let errorCount = 0

    const queue = [...lines]
    async function worker(): Promise<void> {
      while (queue.length > 0) {
        const line = queue.shift()!
        try {
          await window.electronAPI.queue.create({
            prompt: line,
            modelId: batchModel,
            priority: 'medium',
            duration: batchDuration,
            resolution: batchResolution,
            aspectRatio: batchAspectRatio,
          })
        } catch {
          errorCount++
        }
        completed++
        setBatchProgress({ current: completed, total: lines.length })
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, () => worker()))

    setBatchProgress(null)
    setBatchText('')
    setShowBatch(false)
    loadTasks()
    if (errorCount > 0) {
      alert(`批量导入完成：${lines.length - errorCount} 条成功，${errorCount} 条失败`)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const file = e.dataTransfer.files[0]
    if (!file || !file.name.endsWith('.txt')) return

    const reader = new FileReader()
    reader.onload = () => {
      setBatchText(reader.result as string)
    }
    reader.readAsText(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setBatchText(reader.result as string)
    }
    reader.readAsText(file)
  }

  // 客户端过滤
  const filteredTasks = tasks.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false
    if (search && !t.prompt.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // 各状态计数 — 单次遍历
  const statusCounts: Record<TaskStatus, number> = tasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1
      return acc
    },
    { pending: 0, running: 0, completed: 0, failed: 0 } as Record<TaskStatus, number>,
  )

  const statusBadge = (status: TaskStatus, count?: number) => {
    const colors: Record<TaskStatus, string> = {
      pending: 'var(--color-warning)',
      running: 'var(--color-info)',
      completed: 'var(--color-success)',
      failed: 'var(--color-danger)',
    }
    const active = statusFilter === status
    return (
      <button
        key={status}
        onClick={() => setStatusFilter(active ? null : status)}
        style={{
          ...styles.statusBtn,
          backgroundColor: active ? colors[status] : 'var(--color-bg)',
          color: active ? '#fff' : 'var(--color-text-secondary)',
          fontWeight: active ? 600 : 400,
        }}
      >
        {statusLabelMap[status]}
        {count !== undefined && ` (${count})`}
      </button>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.titleRow}>
        <h3 style={styles.title}>任务</h3>
        <button
          onClick={() => setShowBatch(true)}
          style={styles.batchBtn}
          disabled={batchProgress !== null}
        >
          批量导入
        </button>
      </div>

      {/* 搜索框 */}
      <div style={styles.searchBar}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索提示词..."
          style={styles.searchInput}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            style={styles.searchClear}
          >
            x
          </button>
        )}
      </div>

      {/* 状态过滤 */}
      <div style={styles.statusRow}>
        {STATUS_LABELS.map((s) => statusBadge(s, statusCounts[s]))}
      </div>

      {/* 新建任务 */}
      <div style={styles.form}>
        <select
          value={modelId}
          onChange={(e) => handleModelChange(e.target.value)}
          style={styles.select}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {/* 视频配置行：时长 / 分辨率 / 比例 */}
        <div style={styles.configRow}>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            style={{ ...styles.select, flex: 1 }}
            title="视频时长"
          >
            {currentCaps?.durations.map((d) => (
              <option key={d} value={d}>{d}s</option>
            ))}
          </select>

          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            style={{ ...styles.select, flex: 1 }}
            title="视频分辨率"
          >
            {currentCaps?.resolutions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            style={{ ...styles.select, flex: 1 }}
            title="画面比例"
          >
            {currentCaps?.aspectRatios.map((ar) => (
              <option key={ar} value={ar}>{ar}</option>
            ))}
          </select>
        </div>

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          style={styles.select}
        >
          <option value="high">高优先级</option>
          <option value="medium">中优先级</option>
          <option value="low">低优先级</option>
        </select>

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
            border: dragOverInput ? '2px dashed var(--color-accent)' : '2px solid transparent',
            borderRadius: 4,
            transition: 'border-color 0.2s',
          }}
        >
          <textarea
            ref={promptRef}
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
            maxCount={currentCaps?.maxImages ?? 5}
            onRemove={handleRemoveReference}
            onAdd={handleAddFromDialog}
            onOpenPicker={() => setShowMaterialPicker(true)}
          />
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可选备注..."
          style={styles.noteInput}
        />

        <button className="btn-primary" onClick={handleCreate} style={styles.addBtn}>
          + 添加任务
        </button>
      </div>

      {/* 任务列表 */}
      <div style={styles.list}>
        {filteredTasks.length === 0 && (
          <div style={styles.emptyState}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ marginBottom: 'var(--space-4)', opacity: 0.6 }}>
              <rect x="12" y="6" width="36" height="48" rx="4" stroke="var(--color-accent)" strokeWidth="1.5" style={{ fill: 'var(--color-accent-subtle)' }}/>
              <line x1="20" y1="18" x2="40" y2="18" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
              <line x1="20" y1="24" x2="36" y2="24" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
              <line x1="20" y1="30" x2="32" y2="30" stroke="var(--color-accent)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
              <circle cx="38" cy="42" r="12" stroke="var(--color-accent)" strokeWidth="1.2" style={{ fill: 'var(--color-surface)' }}/>
              <polyline points="32,42 37,47 45,37" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <p style={styles.emptyText}>
              {search || statusFilter ? 'No matching tasks' : 'No tasks yet'}
            </p>
            <p style={styles.emptyHint}>
              {search || statusFilter ? 'Try a different filter' : 'Type a prompt and press Ctrl+Enter to start'}
            </p>
          </div>
        )}
        {filteredTasks.map((task) => (
          <div key={task.id} className="task-card" style={styles.taskCard}>
            <div style={styles.taskHeader}>
              {statusBadge(task.status)}
              <span
                style={{
                  ...styles.priorityDot,
                  backgroundColor: priorityColor[task.priority],
                }}
                title={`Priority: ${task.priority}`}
              />
              <span style={styles.modelLabel}>{task.modelId}</span>
              <button
                className="task-delete-btn"
                onClick={() => handleDelete(task.id)}
                style={styles.deleteBtn}
                title="删除任务"
              >
                x
              </button>
            </div>
            <p style={styles.taskPrompt}>{task.prompt}</p>
            {(task.duration || task.resolution || task.aspectRatio) && (
              <p style={styles.videoParams}>
                {task.duration ? `${task.duration}s` : ''}
                {task.resolution ? ` · ${task.resolution}` : ''}
                {task.aspectRatio ? ` · ${task.aspectRatio}` : ''}
              </p>
            )}
            {task.note && <p style={styles.noteText}>{task.note}</p>}
            {task.status === 'failed' && (
              <button
                onClick={() => {
                  window.electronAPI.queue.retry(task.id).then(loadTasks)
                }}
                style={styles.retryBtn}
              >
                重试
              </button>
            )}
            {task.error && <p style={styles.error}>{task.error}</p>}
          </div>
        ))}
      </div>

      {/* 素材库选择器 */}
      {showMaterialPicker && (
        <MaterialPicker
          selectedIds={selectedMaterialIds}
          maxCount={currentCaps?.maxImages ?? 5}
          onSelectionChange={handlePickerSelection}
          onClose={() => setShowMaterialPicker(false)}
        />
      )}

      {/* 批量导入模态框 */}
      {showBatch && (
        <div style={styles.modalOverlay} onClick={() => !batchProgress && setShowBatch(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h4 style={styles.modalTitle}>批量导入</h4>

            <select
              value={batchModel}
              onChange={(e) => {
                const newModel = e.target.value
                setBatchModel(newModel)
                const cap = MODEL_CAPS[newModel]
                if (cap) {
                  setBatchDuration(cap.defaultDuration)
                  setBatchResolution(cap.defaultResolution)
                  setBatchAspectRatio(cap.defaultAspectRatio)
                }
              }}
              style={styles.select}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            <div style={styles.configRow}>
              <select
                value={batchDuration}
                onChange={(e) => setBatchDuration(Number(e.target.value))}
                style={{ ...styles.select, flex: 1 }}
              >
                {(MODEL_CAPS[batchModel]?.durations || [5]).map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
              </select>
              <select
                value={batchResolution}
                onChange={(e) => setBatchResolution(e.target.value)}
                style={{ ...styles.select, flex: 1 }}
              >
                {(MODEL_CAPS[batchModel]?.resolutions || ['720p']).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <select
                value={batchAspectRatio}
                onChange={(e) => setBatchAspectRatio(e.target.value)}
                style={{ ...styles.select, flex: 1 }}
              >
                {(MODEL_CAPS[batchModel]?.aspectRatios || ['16:9']).map((ar) => (
                  <option key={ar} value={ar}>{ar}</option>
                ))}
              </select>
            </div>

            <textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="Paste prompts (one per line)..."
              style={{ ...styles.textarea, minHeight: 150 }}
              rows={8}
              disabled={batchProgress !== null}
            />

            {/* 文件拖放区 */}
            <div
              style={{
                ...styles.dropZone,
                borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
                background: dragOver ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
            >
              <p style={styles.dropText}>
                拖放 .txt 文件到此处，或{' '}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.dropLink}
                >
                  浏览
                </button>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </div>

            {/* 进度 */}
            {batchProgress && (
              <p style={styles.progress}>
                已创建 {batchProgress.current}/{batchProgress.total}
              </p>
            )}

            <div style={styles.modalActions}>
              <button
                onClick={() => { setShowBatch(false); setBatchText(''); setBatchProgress(null) }}
                style={styles.cancelBtn}
                disabled={batchProgress !== null}
              >
              取消
              </button>
              <button
                onClick={handleBatchImport}
                style={styles.addBtn}
                disabled={!batchText.trim() || batchProgress !== null}
              >
                导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--color-surface)',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-3) var(--space-5)',
    background: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-border)',
  },
  title: {
    margin: 0,
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--color-text)',
    letterSpacing: 'var(--tracking-tight)',
  },
  batchBtn: {
    padding: '4px 12px',
    background: 'var(--color-success)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    letterSpacing: 'var(--tracking-normal)',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    padding: 'var(--space-2) var(--space-4)',
    borderBottom: '1px solid var(--color-border-light)',
    position: 'relative',
  },
  searchInput: {
    flex: 1,
    padding: '5px 8px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-sm)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  },
  searchClear: {
    position: 'absolute',
    right: 16,
    background: 'none',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 4px',
    lineHeight: '1',
  },
  statusRow: {
    display: 'flex',
    gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-4)',
    borderBottom: '1px solid var(--color-border-light)',
    flexWrap: 'wrap',
  },
  statusBtn: {
    padding: '3px 10px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    letterSpacing: 'var(--tracking-wide)',
    transition: 'background var(--transition-fast), color var(--transition-fast)',
  },
  form: {
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    borderBottom: '1px solid var(--color-border)',
  },
  configRow: {
    display: 'flex',
    gap: 'var(--space-2)',
  },
  select: {
    padding: '6px 8px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-base)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: 'pointer',
  },
  textarea: {
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-base)',
    resize: 'vertical',
    fontFamily: 'var(--font-sans)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    lineHeight: 'var(--leading-relaxed)',
  },
  noteInput: {
    padding: '6px 8px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'var(--font-sans)',
    background: 'var(--color-bg)',
    color: 'var(--color-text-secondary)',
  },
  addBtn: {
    padding: '8px 16px',
    background: 'var(--color-accent)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontSize: 'var(--text-base)',
    fontWeight: 500,
    letterSpacing: 'var(--tracking-normal)',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--space-3)',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-8) var(--space-4)',
  },
  emptyText: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    margin: 0,
  },
  emptyHint: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    marginTop: 'var(--space-2)',
    opacity: 0.7,
  },
  taskCard: {
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-2)',
    border: '1px solid var(--color-border-light)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'box-shadow var(--transition-fast), border-color var(--transition-fast)',
  },
  taskHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-2)',
  },
  badge: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: '#fff',
    padding: '2px 6px',
    borderRadius: 'var(--radius-sm)',
    letterSpacing: 'var(--tracking-wide)',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  modelLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-secondary)',
    flex: 1,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-danger)',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 600,
    padding: '0 4px',
    lineHeight: '1',
    opacity: 0.6,
    transition: 'opacity var(--transition-fast)',
  },
  taskPrompt: {
    margin: 0,
    fontSize: 'var(--text-base)',
    color: 'var(--color-text)',
    wordBreak: 'break-word',
    lineHeight: 'var(--leading-normal)',
  },
  videoParams: {
    margin: 'var(--space-1) 0 0',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-accent)',
    fontWeight: 500,
  },
  noteText: {
    margin: 'var(--space-1) 0 0',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },
  retryBtn: {
    marginTop: 'var(--space-1)',
    padding: '4px 10px',
    background: 'var(--color-warning)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
  error: {
    margin: 'var(--space-1) 0 0',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-danger)',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(26, 29, 35, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 'var(--z-modal)',
    backdropFilter: 'blur(2px)',
  },
  modal: {
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
    width: 420,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    boxShadow: 'var(--shadow-overlay)',
  },
  modalTitle: {
    margin: 0,
    fontSize: 'var(--text-lg)',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  dropZone: {
    border: '2px dashed',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    textAlign: 'center',
    transition: 'border-color var(--transition-base), background var(--transition-base)',
  },
  dropText: {
    margin: 0,
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
  },
  dropLink: {
    background: 'none',
    border: 'none',
    color: 'var(--color-accent)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    textDecoration: 'underline',
    padding: 0,
  },
  progress: {
    margin: 0,
    fontSize: 'var(--text-sm)',
    color: 'var(--color-success)',
    fontWeight: 500,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--space-3)',
  },
  cancelBtn: {
    padding: '8px 14px',
    background: 'var(--color-bg)',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontSize: 'var(--text-base)',
    fontWeight: 500,
  },
}

export default TaskPanel
