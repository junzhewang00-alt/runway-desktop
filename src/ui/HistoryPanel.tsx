import { useEffect, useState } from 'react'

interface Generation {
  id: string
  taskId: string
  prompt: string
  modelId: string
  modelName: string
  videoUrl?: string
  thumbnailPath?: string
  status: string
  createdAt: number
  duration?: number
  resolution?: string
  aspectRatio?: string
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return new Date(ts).toLocaleDateString()
}

const HistoryPanel: React.FC = () => {
  const [generations, setGenerations] = useState<Generation[]>([])
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [filterModel, setFilterModel] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadHistory = () => {
    const filter: Record<string, unknown> = {}
    if (filterModel) filter.modelId = filterModel
    if (filterDateFrom) filter.dateFrom = new Date(filterDateFrom).getTime()
    if (filterDateTo) filter.dateTo = new Date(filterDateTo + 'T23:59:59').getTime()
    window.electronAPI.history.list(filter).then(setGenerations)
  }

  useEffect(() => {
    window.electronAPI.models.list().then(setModels)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [filterModel, filterDateFrom, filterDateTo])

  const handleRegenerate = (gen: Generation) => {
    window.electronAPI.queue.create({
      prompt: gen.prompt,
      modelId: gen.modelId,
      duration: gen.duration,
      resolution: gen.resolution,
      aspectRatio: gen.aspectRatio,
    })
  }

  const handleCopyPrompt = (gen: Generation) => {
    window.dispatchEvent(new CustomEvent('copy-prompt', {
      detail: {
        prompt: gen.prompt,
        modelId: gen.modelId,
        duration: gen.duration,
        resolution: gen.resolution,
        aspectRatio: gen.aspectRatio,
      },
    }))
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>历史</h3>

      {/* 筛选栏 */}
      <div style={styles.filters}>
        <select
          value={filterModel}
          onChange={(e) => setFilterModel(e.target.value)}
          style={styles.filterSelect}
        >
          <option value="">全部模型</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          style={styles.dateInput}
          title="开始日期"
        />
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          style={styles.dateInput}
          title="结束日期"
        />
      </div>

      {/* 历史列表 */}
      <div style={styles.list}>
        {generations.length === 0 && (
          <p style={styles.empty}>暂无历史记录</p>
        )}
        {generations.map((gen) => (
          <div key={gen.id} className="history-card" style={styles.card}>
            <div
              className="history-card-header"
              style={styles.cardHeader}
              onClick={() => setExpandedId(expandedId === gen.id ? null : gen.id)}
            >
              <div style={styles.thumb}>
                {gen.thumbnailPath ? (
                  <img src={gen.thumbnailPath} alt="" style={styles.thumbImg} />
                ) : (
                  <div style={styles.thumbPlaceholder}>V</div>
                )}
              </div>
              <div style={styles.cardInfo}>
                <p style={styles.cardPrompt}>
                  {gen.prompt.length > 80
                    ? gen.prompt.slice(0, 80) + '...'
                    : gen.prompt}
                </p>
                <div style={styles.cardMeta}>
                  <span style={styles.modelBadge}>{gen.modelName}</span>
                  <span style={styles.timeText}>{relativeTime(gen.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* 展开详情 */}
            {expandedId === gen.id && (
              <div style={styles.detail}>
                <p style={styles.detailPrompt}>{gen.prompt}</p>
                {(gen.duration || gen.resolution || gen.aspectRatio) && (
                  <div style={styles.detailVideoParams}>
                    {gen.duration ? `${gen.duration}s` : ''}
                    {gen.resolution ? ` · ${gen.resolution}` : ''}
                    {gen.aspectRatio ? ` · ${gen.aspectRatio}` : ''}
                  </div>
                )}
                <div style={styles.detailMeta}>
                  <span>模型：{gen.modelName}</span>
                  <span>创建时间：{new Date(gen.createdAt).toLocaleString()}</span>
                  {gen.videoUrl && (
                    <a
                      href={gen.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.videoLink}
                    >
                      打开视频
                    </a>
                  )}
                </div>
                <div style={styles.detailActions}>
                  <button
                    onClick={() => handleRegenerate(gen)}
                    style={styles.regenBtn}
                  >
                    重新生成
                  </button>
                  <button
                    onClick={() => handleCopyPrompt(gen)}
                    style={styles.copyBtn}
                  >
                    复制提示词
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
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
    borderRight: '1px solid var(--color-border)',
  },
  title: {
    margin: 0,
    padding: '10px var(--space-5)',
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    background: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    letterSpacing: 'var(--tracking-tight)',
  },
  filters: {
    display: 'flex',
    gap: 'var(--space-2)',
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--color-border-light)',
    flexWrap: 'wrap',
  },
  filterSelect: {
    flex: 1,
    minWidth: 80,
    padding: '4px 6px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-sm)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: 'pointer',
  },
  dateInput: {
    width: 110,
    padding: '4px 6px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    fontSize: 'var(--text-xs)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--space-3)',
  },
  empty: {
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    padding: 24,
  },
  card: {
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-2)',
    border: '1px solid var(--color-border-light)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
    transition: 'box-shadow var(--transition-fast), border-color var(--transition-fast)',
  },
  cardHeader: {
    display: 'flex',
    padding: 'var(--space-3)',
    cursor: 'pointer',
    gap: 'var(--space-3)',
    transition: 'background var(--transition-fast)',
  },
  thumb: {
    width: 48,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    flexShrink: 0,
    background: 'var(--color-bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbPlaceholder: {
    fontSize: 16,
    color: 'var(--color-text-muted)',
    fontWeight: 600,
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardPrompt: {
    margin: 0,
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text)',
    lineHeight: 'var(--leading-normal)',
    wordBreak: 'break-word',
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginTop: 4,
  },
  modelBadge: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-secondary)',
    background: 'var(--color-bg)',
    padding: '1px 6px',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 500,
  },
  timeText: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
  },
  detail: {
    padding: '0 var(--space-3) var(--space-4)',
    borderTop: '1px solid var(--color-border-light)',
  },
  detailPrompt: {
    margin: 'var(--space-3) 0',
    fontSize: 'var(--text-base)',
    color: 'var(--color-text)',
    lineHeight: 'var(--leading-normal)',
    wordBreak: 'break-word',
  },
  detailMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-secondary)',
    marginBottom: 'var(--space-3)',
  },
  videoLink: {
    color: 'var(--color-accent)',
    fontSize: 'var(--text-xs)',
    cursor: 'pointer',
    fontWeight: 500,
  },
  detailVideoParams: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-accent)',
    fontWeight: 500,
    marginBottom: 'var(--space-2)',
  },
  detailActions: {
    display: 'flex',
    gap: 'var(--space-2)',
  },
  regenBtn: {
    padding: '5px 12px',
    background: 'var(--color-accent)',
    color: 'var(--color-text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
  copyBtn: {
    padding: '5px 12px',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
}

export default HistoryPanel
