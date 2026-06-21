import { useEffect, useState } from 'react'
import type { Material } from '../types/materials'
import { useFileDrop } from './hooks/useFileDrop'

const MaterialPanel: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const loadMaterials = () => {
    window.electronAPI.material.list().then(setMaterials)
  }

  useEffect(() => {
    loadMaterials()
  }, [])

  const handleImport = async () => {
    const paths = await window.electronAPI.material.openDialog()
    if (paths.length > 0) {
      await window.electronAPI.material.import(paths)
      loadMaterials()
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await window.electronAPI.material.delete(id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    loadMaterials()
  }

  const handleSelect = (id: string, e: React.MouseEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (e.ctrlKey || e.metaKey) {
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
      } else {
        next.clear()
        next.add(id)
      }
      return next
    })
  }
  const { dragOver, handleDragOver, handleDragLeave, handleDrop, dragBorderColor } = useFileDrop({
    onFiles: async (paths: string[]) => {
      await window.electronAPI.material.import(paths)
      loadMaterials()
    },
  })

  return (
    <div
      style={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div style={styles.toolbar}>
        <button onClick={handleImport} style={styles.importBtn}>
          导入图片
        </button>
        {selectedIds.size > 0 && (
          <span style={styles.selectedCount}>
            已选 {selectedIds.size} 张
          </span>
        )}
      </div>

      <div
        style={{
          ...styles.grid,
          borderColor: dragBorderColor,
        }}
      >
        {materials.length === 0 && (
          <div style={styles.emptyState}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }}>
              <rect x="8" y="10" width="40" height="36" rx="6" stroke="var(--color-accent)" strokeWidth="1.2" style={{ fill: 'var(--color-accent-subtle)' }}/>
              <circle cx="22" cy="26" r="6" stroke="var(--color-accent)" strokeWidth="1" opacity="0.5"/>
              <path d="M30,38 L42,18" stroke="var(--color-accent)" strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
              <polygon points="38,16 44,24 32,24" style={{ fill: 'var(--color-accent)' }} opacity="0.3"/>
            </svg>
            <p style={styles.emptyText}>暂无素材</p>
            <p style={styles.emptyHint}>拖拽图片到此处或点击上方按钮导入</p>
          </div>
        )}

        {materials.map((mat) => {
          const isSelected = selectedIds.has(mat.id)
          return (
            <div
              key={mat.id}
              draggable={true}
              onDragStart={(e) => {
                // 获取要拖拽的 material id 列表（支持多选）
                const ids = selectedIds.has(mat.id)
                  ? Array.from(selectedIds)
                  : [mat.id]

                // 校验数量上限
                if (ids.length > 9) {
                  e.preventDefault()
                  alert('单次最多拖拽 9 张参考图')
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
              className="material-card"
              style={{
                ...styles.card,
                borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border-light)',
              }}
            >
              <img
                src={`material-file://${mat.id}/`}
                alt={mat.fileName}
                style={styles.thumbnail}
              />
              <button
                className="material-delete-btn"
                onClick={(e) => handleDelete(mat.id, e)}
                style={styles.deleteBtn}
              >
                x
              </button>
            </div>
          )
        })}
      </div>
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
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-border)',
  },
  importBtn: {
    padding: '6px 14px',
    background: 'var(--color-accent)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
  },
  selectedCount: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-secondary)',
  },
  grid: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-3)',
    padding: 'var(--space-3)',
    alignContent: 'flex-start',
    border: '2px solid transparent',
    transition: 'border-color var(--transition-base)',
  },
  empty: {
    width: '100%',
    textAlign: 'center' as const,
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    padding: 40,
  },
  emptyState: {
    width: '100%',
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
  card: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: 'var(--radius-md)',
    border: '2px solid',
    overflow: 'hidden',
    cursor: 'pointer',
    background: 'var(--color-bg)',
    flexShrink: 0,
    transition: 'transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast)',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  deleteBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    background: 'rgba(196, 85, 77, 0.88)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '18px',
    textAlign: 'center',
    padding: 0,
    opacity: 0,
    transition: 'opacity 0.15s',
  },
}

export default MaterialPanel
