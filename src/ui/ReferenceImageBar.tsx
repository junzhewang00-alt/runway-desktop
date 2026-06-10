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
