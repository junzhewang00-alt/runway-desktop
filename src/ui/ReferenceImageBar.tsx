import { useState } from 'react'
import type { Material } from '../types/materials'

interface ReferenceImageBarProps {
  images: Material[]
  maxCount?: number
  onRemove: (id: string) => void
  onAdd: () => void
  onOpenPicker?: () => void
}

const ReferenceImageBar: React.FC<ReferenceImageBarProps> = ({
  images,
  maxCount = 5,
  onRemove,
  onAdd,
  onOpenPicker,
}) => {
  const [previewId, setPreviewId] = useState<string | null>(null)

  const previewImage = previewId
    ? images.find((img) => img.id === previewId)
    : null

  return (
    <div style={styles.container}>
      <div style={styles.label}>
        参考图（{images.length}/{maxCount}，拖拽图片到此处添加）:
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
        {images.length < maxCount && (
          <button className="ref-add-btn" onClick={onAdd} style={styles.addBtn} title="添加参考图">
            +
          </button>
        )}
        {onOpenPicker && (
          <button
            className="ref-picker-btn"
            onClick={onOpenPicker}
            style={styles.pickerBtn}
            title="从素材库选择"
          >
            <span style={styles.pickerIcon}>⊞</span>
            <span>素材库</span>
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
    marginTop: 'var(--space-3)',
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--color-bg)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border-light)',
  },
  label: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-2)',
    fontWeight: 500,
  },
  thumbnails: {
    display: 'flex',
    gap: 'var(--space-2)',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  card: {
    position: 'relative' as const,
    width: 64,
    height: 64,
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    border: '2px solid var(--color-border-light)',
    background: 'var(--color-surface)',
    flexShrink: 0,
    transition: 'border-color var(--transition-fast)',
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
    background: 'rgba(196, 85, 77, 0.88)',
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
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const,
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: 64,
  },
  pickerBtn: {
    width: 64,
    height: 64,
    borderRadius: 'var(--radius-md)',
    border: '2px dashed var(--color-border)',
    background: 'var(--color-surface-hover)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    flexShrink: 0,
    transition: 'border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast)',
  },
  pickerIcon: {
    fontSize: 16,
    lineHeight: '1',
  },
  addBtn: {
    width: 64,
    height: 64,
    borderRadius: 'var(--radius-md)',
    border: '2px dashed var(--color-border)',
    background: 'var(--color-surface-hover)',
    cursor: 'pointer',
    fontSize: 24,
    color: 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast)',
  },
  lightbox: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(26, 29, 35, 0.92)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  },
  lightboxImg: {
    maxWidth: '90%',
    maxHeight: '90%',
    objectFit: 'contain' as const,
    cursor: 'default',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-overlay)',
  },
  lightboxClose: {
    position: 'absolute' as const,
    top: 20,
    right: 20,
    padding: '8px 18px',
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    backdropFilter: 'blur(8px)',
  },
}

export default ReferenceImageBar
