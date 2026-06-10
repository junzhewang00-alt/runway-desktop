import React, { useEffect, useState, useRef } from 'react'
import type { Task, TaskStatus, TaskPriority } from '../types/tasks'
import ReferenceImageBar from './ReferenceImageBar'
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
  high: '#d9534f',
  medium: '#f0ad4e',
  low: '#999',
}

const TaskPanel: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([])
  const [prompt, setPrompt] = useState('')
  const [modelId, setModelId] = useState('wan-2.6')
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [note, setNote] = useState('')
  const [referenceImages, setReferenceImages] = useState<Material[]>([])
  const [dragOverInput, setDragOverInput] = useState(false)

  // 搜索 & 过滤
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null)

  // 批量导入
  const [showBatch, setShowBatch] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchModel, setBatchModel] = useState('wan-2.6')
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadTasks = () => {
    window.electronAPI.queue.list().then(setTasks)
  }

  const loadModels = () => {
    window.electronAPI.models.list().then(setModels)
  }

  useEffect(() => {
    loadTasks()
    loadModels()
    const timer = setInterval(loadTasks, 3000)
    return () => clearInterval(timer)
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
    }).then(() => {
      setPrompt('')
      setNote('')
      setReferenceImages([])
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
        const uniqueNew = newImages.filter((m) => !existingIds.has(m.id))
        const combined = [...prev, ...uniqueNew]
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

  // 批量导入
  const handleBatchImport = async () => {
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    if (lines.length === 0) return

    setBatchProgress({ current: 0, total: lines.length })

    for (let i = 0; i < lines.length; i++) {
      await window.electronAPI.queue.create({
        prompt: lines[i],
        modelId: batchModel,
        priority: 'medium',
      })
      setBatchProgress({ current: i + 1, total: lines.length })
    }

    setBatchProgress(null)
    setBatchText('')
    setShowBatch(false)
    loadTasks()
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

  // 各状态计数
  const statusCounts: Record<TaskStatus, number> = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  }

  const statusBadge = (status: TaskStatus, count?: number) => {
    const colors: Record<TaskStatus, string> = {
      pending: '#f0ad4e',
      running: '#5bc0de',
      completed: '#5cb85c',
      failed: '#d9534f',
    }
    const active = statusFilter === status
    return (
      <button
        key={status}
        onClick={() => setStatusFilter(active ? null : status)}
        style={{
          ...styles.statusBtn,
          backgroundColor: active ? colors[status] : '#e8e8e8',
          color: active ? '#fff' : '#666',
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
          onChange={(e) => setModelId(e.target.value)}
          style={styles.select}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

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

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可选备注..."
          style={styles.noteInput}
        />

        <button onClick={handleCreate} style={styles.addBtn}>
          + 添加任务
        </button>
      </div>

      {/* 任务列表 */}
      <div style={styles.list}>
        {filteredTasks.length === 0 && (
          <p style={styles.empty}>
            {search || statusFilter ? 'No matching tasks' : 'No tasks yet'}
          </p>
        )}
        {filteredTasks.map((task) => (
          <div key={task.id} style={styles.taskCard}>
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
                onClick={() => handleDelete(task.id)}
                style={styles.deleteBtn}
                title="删除任务"
              >
                x
              </button>
            </div>
            <p style={styles.taskPrompt}>{task.prompt}</p>
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

      {/* 批量导入模态框 */}
      {showBatch && (
        <div style={styles.modalOverlay} onClick={() => !batchProgress && setShowBatch(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h4 style={styles.modalTitle}>批量导入</h4>

            <select
              value={batchModel}
              onChange={(e) => setBatchModel(e.target.value)}
              style={styles.select}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

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
                borderColor: dragOver ? '#0078d4' : '#ccc',
                background: dragOver ? '#e8f0fe' : '#fafafa',
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
    background: '#f5f5f5',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: '#e8e8e8',
    borderBottom: '1px solid #ddd',
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
  },
  batchBtn: {
    padding: '4px 10px',
    background: '#5cb85c',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderBottom: '1px solid #ddd',
    position: 'relative',
  },
  searchInput: {
    flex: 1,
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: 12,
  },
  searchClear: {
    position: 'absolute',
    right: 16,
    background: 'none',
    border: 'none',
    color: '#999',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 4px',
  },
  statusRow: {
    display: 'flex',
    gap: '6px',
    padding: '6px 12px',
    borderBottom: '1px solid #ddd',
    flexWrap: 'wrap',
  },
  statusBtn: {
    padding: '2px 8px',
    borderRadius: 3,
    border: 'none',
    cursor: 'pointer',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  form: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    borderBottom: '1px solid #ddd',
  },
  select: {
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: 13,
  },
  textarea: {
    padding: '8px',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: 13,
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  noteInput: {
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  addBtn: {
    padding: '8px 12px',
    background: '#0078d4',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  },
  empty: {
    textAlign: 'center',
    color: '#999',
    fontSize: 13,
    padding: 20,
  },
  taskCard: {
    background: '#fff',
    borderRadius: 4,
    padding: '10px',
    marginBottom: '8px',
    border: '1px solid #e0e0e0',
  },
  taskHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    color: '#fff',
    padding: '2px 6px',
    borderRadius: 3,
    textTransform: 'uppercase',
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  modelLabel: {
    fontSize: 11,
    color: '#666',
    flex: 1,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#d9534f',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    padding: '0 4px',
  },
  taskPrompt: {
    margin: 0,
    fontSize: 13,
    color: '#333',
    wordBreak: 'break-word',
  },
  noteText: {
    margin: '4px 0 0',
    fontSize: 11,
    color: '#888',
    fontStyle: 'italic',
  },
  retryBtn: {
    marginTop: 4,
    padding: '4px 8px',
    background: '#f0ad4e',
    color: '#fff',
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 11,
  },
  error: {
    margin: '4px 0 0',
    fontSize: 11,
    color: '#d9534f',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: 8,
    padding: '20px',
    width: 420,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  },
  modalTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
  },
  dropZone: {
    border: '2px dashed',
    borderRadius: 6,
    padding: '16px',
    textAlign: 'center',
    transition: 'border-color 0.2s, background 0.2s',
  },
  dropText: {
    margin: 0,
    fontSize: 12,
    color: '#666',
  },
  dropLink: {
    background: 'none',
    border: 'none',
    color: '#0078d4',
    cursor: 'pointer',
    fontSize: 12,
    textDecoration: 'underline',
    padding: 0,
  },
  progress: {
    margin: 0,
    fontSize: 12,
    color: '#5cb85c',
    fontWeight: 500,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cancelBtn: {
    padding: '8px 12px',
    background: '#e8e8e8',
    color: '#333',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
  },
}

export default TaskPanel
