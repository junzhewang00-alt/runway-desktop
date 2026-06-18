import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '../preload/index'
import type { Task } from '../types/tasks'

const MAX_LOGS = 200

const QueueStatusPanel: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // 轮询任务状态
  useEffect(() => {
    const poll = () => {
      window.electronAPI.queue.list().then(setTasks)
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [])

  // 监听全局快捷键
  useEffect(() => {
    return window.electronAPI.shortcuts.onExportLogs(() => {
      window.electronAPI.logger.export()
    })
  }, [])

  // 监听日志
  useEffect(() => {
    const unsubscribe = window.electronAPI.onLog((entry: LogEntry) => {
      setLogs((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
      })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const counts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1
    return acc
  }, { pending: 0, running: 0, completed: 0, failed: 0 } as Record<string, number>)
  const pending = counts.pending
  const running = tasks.filter((t) => t.status === 'running')
  const completed = counts.completed
  const failed = counts.failed

  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return '#d9534f'
      case 'warn': return '#f0ad4e'
      default: return '#5bc0de'
    }
  }

  return (
    <div style={styles.container}>
      {/* 队列状态 */}
      <div style={styles.statusSection}>
        <h3 style={styles.title}>状态</h3>
        <div style={styles.statsGrid}>
          <div style={{ ...styles.statCard, borderLeftColor: 'var(--color-warning)' }}>
            <div style={styles.statValue}>{pending}</div>
            <div style={styles.statLabel}>排队中</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: 'var(--color-info)' }}>
            <div style={styles.statValue}>{running.length}</div>
            <div style={styles.statLabel}>生成中</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: 'var(--color-success)' }}>
            <div style={styles.statValue}>{completed}</div>
            <div style={styles.statLabel}>已完成</div>
          </div>
          <div style={{ ...styles.statCard, borderLeftColor: 'var(--color-danger)' }}>
            <div style={styles.statValue}>{failed}</div>
            <div style={styles.statLabel}>失败</div>
          </div>
        </div>

        {/* 正在运行的任务 */}
        {running.length > 0 && (
          <div style={styles.runningList}>
            {running.map((t) => (
              <div key={t.id} style={styles.runningItem}>
                <div style={styles.runningDot} />
                <div style={styles.runningInfo}>
                  <span style={styles.runningModel}>{t.modelId}</span>
                  <span style={styles.runningPrompt}>
                    {t.prompt.length > 40 ? t.prompt.slice(0, 40) + '...' : t.prompt}
                  </span>
                </div>
                {t.duration && (
                  <span style={styles.runningParams}>{t.duration}s{t.resolution ? ` ${t.resolution}` : ''}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 日志区域（可折叠） */}
      <div style={styles.logSection}>
        <div style={styles.logHeader} onClick={() => setShowLogs(!showLogs)}>
          <span style={styles.logTitle}>
            {showLogs ? '▼' : '▶'} 日志
          </span>
          <div style={styles.logActions}>
            {showLogs && (
              <>
                <label style={styles.autoScrollLabel}>
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  自动滚动
                </label>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    window.electronAPI.logger.export()
                  }}
                  style={styles.exportBtn}
                >
                  导出
                </button>
              </>
            )}
          </div>
        </div>
        {showLogs && (
          <div ref={scrollRef} style={styles.logList}>
            {logs.length === 0 && <p style={styles.empty}>等待日志...</p>}
            {logs.map((entry, i) => (
              <div key={i} style={styles.logEntry}>
                <span style={styles.logTime}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span style={{ ...styles.logLevel, color: levelColor(entry.level) }}>
                  {entry.level.toUpperCase()}
                </span>
                <span style={styles.logModule}>[{entry.module}]</span>
                <span style={styles.logMessage}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--color-dark-bg)',
    color: 'var(--color-dark-text)',
    borderLeft: '1px solid var(--color-dark-border)',
  },
  statusSection: {
    flexShrink: 0,
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--color-dark-border)',
  },
  title: {
    margin: '0 0 var(--space-3) 0',
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--color-dark-text)',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-3)',
  },
  statCard: {
    background: 'var(--color-dark-surface)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-2) var(--space-3)',
    borderLeft: '3px solid',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '1.4rem',
    fontWeight: 700,
    color: 'var(--color-dark-text)',
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-dark-text-secondary)',
    marginTop: 2,
  },
  runningList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  },
  runningItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-1) var(--space-2)',
    background: 'rgba(59,130,246,0.08)',
    borderRadius: 'var(--radius-sm)',
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--color-info)',
    flexShrink: 0,
    animation: 'pulse 1.5s infinite',
  },
  runningInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  runningModel: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--color-info)',
  },
  runningPrompt: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-dark-text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  runningParams: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-dark-text-secondary)',
    flexShrink: 0,
  },
  logSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  logHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-2) var(--space-4)',
    background: 'var(--color-dark-surface)',
    borderBottom: '1px solid var(--color-dark-border)',
    cursor: 'pointer',
    userSelect: 'none',
  },
  logTitle: {
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--color-dark-text-secondary)',
  },
  logActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  autoScrollLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-dark-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  exportBtn: {
    padding: '3px 8px',
    background: 'var(--color-dark-border)',
    color: 'var(--color-dark-text)',
    border: '1px solid var(--color-dark-border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
  logList: {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--space-2) var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: 1.5,
  },
  empty: {
    color: 'var(--color-dark-text-secondary)',
    textAlign: 'center',
    padding: 24,
  },
  logEntry: {
    display: 'flex',
    gap: 'var(--space-2)',
    whiteSpace: 'nowrap',
    padding: '1px 0',
    fontSize: '11px',
  },
  logTime: {
    color: 'var(--color-dark-text-secondary)',
    flexShrink: 0,
  },
  logLevel: {
    fontWeight: 600,
    flexShrink: 0,
    minWidth: 35,
  },
  logModule: {
    color: '#6a9ecf',
    flexShrink: 0,
  },
  logMessage: {
    color: 'var(--color-dark-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
}

// 注入 pulse 动画
if (typeof document !== 'undefined' && !document.getElementById('qs-pulse-style')) {
  const style = document.createElement('style')
  style.id = 'qs-pulse-style'
  style.textContent = '@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }'
  document.head.appendChild(style)
}

export default QueueStatusPanel
