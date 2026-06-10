import React, { useEffect, useState } from 'react'
import type { Material } from '../types/materials'

const MaterialPanel: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']

    // Electron sandbox:false 时 File 对象有 .path 属性
    const paths = files
      .filter((f) => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase()
        return imageExtensions.includes(ext)
      })
      .map((f) => (f as any).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    if (paths.length > 0) {
      await window.electronAPI.material.import(paths)
      loadMaterials()
    }
  }

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
          borderColor: dragOver ? '#0078d4' : 'transparent',
        }}
      >
        {materials.length === 0 && (
          <p style={styles.empty}>
            暂无素材，拖拽图片到此处或点击上方按钮导入
          </p>
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
              <img
                src={`material-file://${mat.id}/`}
                alt={mat.fileName}
                style={styles.thumbnail}
              />
              <button
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
    background: '#f5f5f5',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#e8e8e8',
    borderBottom: '1px solid #ddd',
  },
  importBtn: {
    padding: '6px 14px',
    background: '#0078d4',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  },
  selectedCount: {
    fontSize: 11,
    color: '#666',
  },
  grid: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '8px',
    alignContent: 'flex-start',
    border: '2px solid transparent',
    transition: 'border-color 0.2s',
  },
  empty: {
    width: '100%',
    textAlign: 'center',
    color: '#999',
    fontSize: 13,
    padding: 40,
  },
  card: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: 4,
    border: '2px solid',
    overflow: 'hidden',
    cursor: 'pointer',
    background: '#fff',
    flexShrink: 0,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  deleteBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    background: 'rgba(217, 83, 79, 0.85)',
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
