import { useEffect, useState, useCallback } from 'react'
import type { Material } from '../types/materials'

interface MaterialPickerProps {
  selectedIds: Set<string>
  maxCount?: number
  onSelectionChange: (ids: string[]) => void
  onClose: () => void
}

const MATERIAL_COUNT_MAX = 9

const MaterialPicker: React.FC<MaterialPickerProps> = ({
  selectedIds,
  maxCount = MATERIAL_COUNT_MAX,
  onSelectionChange,
  onClose,
}) => {
  const [materials, setMaterials] = useState<Material[]>([])
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set(selectedIds))
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)

  const loadMaterials = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.material.list()
      setMaterials(list)
    } catch {
      /* IPC error, show empty */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMaterials()
  }, [loadMaterials])

  // 弹窗打开时隐藏 BrowserView（原生层遮挡问题），关闭时恢复
  useEffect(() => {
    window.electronAPI.browser.hide()
    return () => {
      window.electronAPI.browser.show()
    }
  }, [])

  // Escape key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const togglePick = (id: string, e: React.MouseEvent) => {
    setPickedIds((prev) => {
      const next = new Set(prev)
      // Ctrl/Cmd+click for multi-select toggling
      if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) {
          next.delete(id)
        } else if (next.size < maxCount) {
          next.add(id)
        }
        return next
      }
      // Simple click: toggle single
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < maxCount) {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    const ids = materials.slice(0, maxCount).map((m) => m.id)
    setPickedIds(new Set(ids))
  }

  const handleDeselectAll = () => {
    setPickedIds(new Set())
  }

  const handleConfirm = () => {
    onSelectionChange(Array.from(pickedIds))
    onClose()
  }

  const handleImport = async () => {
    const paths = await window.electronAPI.material.openDialog()
    if (paths.length > 0) {
      setImporting(true)
      try {
        const imported = await window.electronAPI.material.import(paths)
        // Refresh list and auto-select newly imported
        const list = await window.electronAPI.material.list()
        setMaterials(list)
        const newIds = imported.map((m) => m.id)
        setPickedIds((prev) => {
          const next = new Set(prev)
          for (const id of newIds) {
            if (next.size >= maxCount) break
            next.add(id)
          }
          return next
        })
      } finally {
        setImporting(false)
      }
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']
    const paths = files
      .filter((f) => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase()
        return imageExtensions.includes(ext)
      })
      .map((f) => (f as any).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    if (paths.length === 0) return

    setImporting(true)
    try {
      const imported = await window.electronAPI.material.import(paths)
      const list = await window.electronAPI.material.list()
      setMaterials(list)
      const newIds = imported.map((m) => m.id)
      setPickedIds((prev) => {
        const next = new Set(prev)
        for (const id of newIds) {
          if (next.size >= maxCount) break
          next.add(id)
        }
        return next
      })
    } finally {
      setImporting(false)
    }
  }

  const currentCount = pickedIds.size
  const showWarning = currentCount >= maxCount

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={styles.header}>
          <h3 style={styles.title}>素材库</h3>
          <div style={styles.headerActions}>
            <button onClick={handleSelectAll} style={styles.headerBtn}>
              全选
            </button>
            <button onClick={handleDeselectAll} style={styles.headerBtn}>
              取消全选
            </button>
            <button
              onClick={handleImport}
              style={{ ...styles.headerBtn, ...styles.importBtn }}
              disabled={importing}
            >
              {importing ? '导入中...' : '导入图片'}
            </button>
          </div>
        </div>

        {/* Drop zone wrapping the grid */}
        <div
          className={`material-picker-drop-zone${dragOver ? ' drag-over' : ''}`}
          style={{
            ...styles.dropZone,
            borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
            background: dragOver ? 'var(--color-accent-subtle)' : 'var(--color-bg)',
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            // Only set false if leaving the drop zone (not entering a child)
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            setDragOver(false)
          }}
          onDrop={handleDrop}
        >
          {loading && (
            <p style={styles.message}>加载中...</p>
          )}
          {!loading && materials.length === 0 && (
            <p style={styles.message}>
              暂无素材，点击「导入图片」或拖拽图片到此处
            </p>
          )}
          {!loading && materials.length > 0 && (
            <div style={styles.grid}>
              {materials.map((mat) => {
                const isPicked = pickedIds.has(mat.id)
                const atLimit = !isPicked && showWarning
                return (
                  <div
                    key={mat.id}
                    className={`material-picker-card${isPicked ? ' selected' : ''}`}
                    title={mat.fileName}
                    style={{
                      ...styles.card,
                      borderColor: isPicked
                        ? 'var(--color-accent)'
                        : 'var(--color-border-light)',
                      opacity: atLimit ? 0.4 : 1,
                      cursor: atLimit ? 'not-allowed' : 'pointer',
                    }}
                    onClick={(e) => {
                      if (!atLimit) togglePick(mat.id, e)
                    }}
                  >
                    <img
                      src={`material-file://${mat.id}/`}
                      alt={mat.fileName}
                      style={styles.thumbnail}
                    />
                    {isPicked && (
                      <div className="material-picker-check" style={styles.check}>
                        ✓
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Status bar */}
        <div style={styles.statusBar}>
          <span style={styles.statusText}>
            已选 {currentCount}/{maxCount} 张
          </span>
          {showWarning && !loading && materials.length > maxCount && (
            <span style={styles.warningText}>已达上限</span>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            style={{
              ...styles.confirmBtn,
              opacity: currentCount === 0 ? 0.5 : 1,
              cursor: currentCount === 0 ? 'not-allowed' : 'pointer',
            }}
            disabled={currentCount === 0}
          >
            确认添加 ({currentCount})
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
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
    width: 560,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-overlay)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-4) var(--space-5)',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--color-text)',
    letterSpacing: 'var(--tracking-tight)',
  },
  headerActions: {
    display: 'flex',
    gap: 'var(--space-2)',
  },
  headerBtn: {
    padding: '4px 10px',
    background: 'var(--color-bg)',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
  importBtn: {
    background: 'var(--color-accent)',
    color: 'var(--color-text-inverse)',
    borderColor: 'var(--color-accent)',
  },
  dropZone: {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--space-4)',
    border: '2px dashed',
    borderRadius: 'var(--radius-md)',
    margin: 'var(--space-4)',
    transition: 'border-color var(--transition-base), background var(--transition-base)',
  },
  grid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-3)',
    alignContent: 'flex-start',
  },
  card: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: 'var(--radius-md)',
    border: '2px solid',
    overflow: 'hidden',
    background: 'var(--color-bg)',
    flexShrink: 0,
    transition: 'transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast)',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  check: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: 'var(--color-accent)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  message: {
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    padding: 40,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-2) var(--space-5)',
    borderTop: '1px solid var(--color-border-light)',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
  },
  warningText: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-warning)',
    fontWeight: 500,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 'var(--space-3)',
    padding: 'var(--space-4) var(--space-5)',
    borderTop: '1px solid var(--color-border)',
    flexShrink: 0,
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
  confirmBtn: {
    padding: '8px 18px',
    background: 'var(--color-accent)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontSize: 'var(--text-base)',
    fontWeight: 500,
  },
}

export default MaterialPicker
