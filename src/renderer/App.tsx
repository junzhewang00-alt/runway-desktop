import { useState, useCallback, useRef, useEffect } from 'react'
import ErrorBoundary from '../ui/ErrorBoundary'
import TaskPanel from '../ui/TaskPanel'
import HistoryPanel from '../ui/HistoryPanel'
import BrowserPanel from '../ui/BrowserPanel'
import QueueStatusPanel from '../ui/QueueStatusPanel'
import MaterialPanel from '../ui/MaterialPanel'

type Panel = 'left' | 'right'
type LeftTab = 'tasks' | 'history' | 'materials'

const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH_RATIO = 0.40 // 单个面板最大占窗口宽度的 40%
const DEFAULT_PANEL_RATIO = 0.18 // 默认面板占窗口宽度的 18%
const STORAGE_KEY_LEFT = 'runway-layout-left-width'
const STORAGE_KEY_RIGHT = 'runway-layout-right-width'
const STORAGE_KEY_LEFT_COLLAPSED = 'runway-layout-left-collapsed'
const STORAGE_KEY_RIGHT_COLLAPSED = 'runway-layout-right-collapsed'
const STORAGE_KEY_THEME = 'runway-theme'
const COLLAPSED_WIDTH = 40

/** 从 localStorage 读取保存的宽度，无记录时返回 null */
function loadSavedWidth(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const val = parseInt(raw, 10)
      if (Number.isFinite(val) && val > 0) return val
    }
  } catch { /* localStorage 不可用 */ }
  return null
}

/** 保存宽度到 localStorage */
function saveWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(Math.round(width)))
  } catch { /* localStorage 不可用 */ }
}

/** 根据窗口宽度计算默认面板尺寸 */
function calcDefaultWidth(windowWidth: number): number {
  const ratio = Math.round(windowWidth * DEFAULT_PANEL_RATIO)
  const max = Math.round(windowWidth * MAX_PANEL_WIDTH_RATIO)
  return Math.max(MIN_PANEL_WIDTH, Math.min(ratio, max))
}

const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)

  const [leftWidth, setLeftWidth] = useState(() => {
    return loadSavedWidth(STORAGE_KEY_LEFT) ?? calcDefaultWidth(window.innerWidth)
  })
  const [rightWidth, setRightWidth] = useState(() => {
    return loadSavedWidth(STORAGE_KEY_RIGHT) ?? calcDefaultWidth(window.innerWidth)
  })
  const [leftTab, setLeftTab] = useState<LeftTab>('tasks')
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_LEFT_COLLAPSED) === 'true' } catch { return false }
  })
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_RIGHT_COLLAPSED) === 'true' } catch { return false }
  })
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_THEME) === 'dark' } catch { return false }
  })

  // 主题初始化 & 同步
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    try { localStorage.setItem(STORAGE_KEY_THEME, dark ? 'dark' : 'light') } catch { /* ok */ }
  }, [dark])

  const toggleLeftCollapse = useCallback(() => {
    setLeftCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY_LEFT_COLLAPSED, String(next)) } catch { /* ok */ }
      return next
    })
  }, [])

  const toggleRightCollapse = useCallback(() => {
    setRightCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY_RIGHT_COLLAPSED, String(next)) } catch { /* ok */ }
      return next
    })
  }, [])

  // 拖拽状态用 ref 存储，避免 mousemove 时创建新闭包或触发重渲染
  const dragStateRef = useRef<{ panel: Panel; lw: number; rw: number } | null>(null)
  const rafRef = useRef<number | null>(null)
  const draggingPanel = useRef<Panel | null>(null)
  // 始终保持与最新 state 同步的宽度 ref
  const widthRef = useRef({ left: leftWidth, right: rightWidth })
  widthRef.current = { left: leftWidth, right: rightWidth }
  const [dragging, setDragging] = useState<Panel | null>(null)

  // 监听窗口 resize
  useEffect(() => {
    const handleResize = () => {
      const savedLeft = loadSavedWidth(STORAGE_KEY_LEFT)
      if (savedLeft === null) {
        setLeftWidth(calcDefaultWidth(window.innerWidth))
      }
      const savedRight = loadSavedWidth(STORAGE_KEY_RIGHT)
      if (savedRight === null) {
        setRightWidth(calcDefaultWidth(window.innerWidth))
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleResetLayout = useCallback(() => {
    const w = window.innerWidth
    const newLeft = calcDefaultWidth(w)
    const newRight = calcDefaultWidth(w)
    setLeftWidth(newLeft)
    setRightWidth(newRight)
    saveWidth(STORAGE_KEY_LEFT, newLeft)
    saveWidth(STORAGE_KEY_RIGHT, newRight)
  }, [])

  // 稳定的 mousemove handler — 无依赖，通过 ref 读取最新值
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const ds = dragStateRef.current
    if (!ds || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const totalWidth = rect.width
    let newLeft = ds.lw
    let newRight = ds.rw

    if (ds.panel === 'left') {
      newLeft = Math.max(MIN_PANEL_WIDTH, Math.min(e.clientX - rect.left, totalWidth - MIN_PANEL_WIDTH - ds.rw))
    } else {
      newRight = Math.max(MIN_PANEL_WIDTH, Math.min(rect.right - e.clientX, totalWidth - ds.lw - MIN_PANEL_WIDTH))
    }

    // 用 ref 缓存最新计算值，避免 rAF 读取过时的 state
    dragStateRef.current = { panel: ds.panel, lw: newLeft, rw: newRight }

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const cur = dragStateRef.current
        if (cur) {
          setLeftWidth(cur.lw)
          setRightWidth(cur.rw)
        }
      })
    }
  }, [])

  const onMouseDown = useCallback((panel: Panel) => {
    dragStateRef.current = { panel, lw: widthRef.current.left, rw: widthRef.current.right }
    draggingPanel.current = panel
    setDragging(panel)
  }, [])

  const onMouseUp = useCallback(() => {
    setDragging(null)
    const ds = dragStateRef.current
    if (ds) {
      saveWidth(STORAGE_KEY_LEFT, ds.lw)
      saveWidth(STORAGE_KEY_RIGHT, ds.rw)
    }
    dragStateRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={styles.container}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* 左侧面板：Tasks / History 切换 */}
      <div style={{ ...styles.panel, width: leftCollapsed ? COLLAPSED_WIDTH : leftWidth, flexShrink: 0, transition: 'width 0.2s ease' }}>
        {leftCollapsed ? (
          <div style={styles.collapsedPanel} onClick={toggleLeftCollapse} title="展开面板">
            <span style={styles.collapsedLabel}>{leftTab === 'tasks' ? '任务' : leftTab === 'history' ? '历史' : '素材'}</span>
          </div>
        ) : (
          <>
            <div style={styles.tabBar}>
              <button className="tab-btn" onClick={() => setLeftTab('tasks')} style={{ ...styles.tab, ...(leftTab === 'tasks' ? styles.tabActive : {}) }}>任务</button>
              <button className="tab-btn" onClick={() => setLeftTab('history')} style={{ ...styles.tab, ...(leftTab === 'history' ? styles.tabActive : {}) }}>历史</button>
              <button className="tab-btn" onClick={() => setLeftTab('materials')} style={{ ...styles.tab, ...(leftTab === 'materials' ? styles.tabActive : {}) }}>素材</button>
              <button onClick={toggleLeftCollapse} style={styles.collapseBtn} title="折叠面板">«</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {leftTab === 'tasks' && <ErrorBoundary panelName="Task Panel"><TaskPanel /></ErrorBoundary>}
              {leftTab === 'history' && <ErrorBoundary panelName="History Panel"><HistoryPanel /></ErrorBoundary>}
              {leftTab === 'materials' && <ErrorBoundary panelName="Material Panel"><MaterialPanel /></ErrorBoundary>}
            </div>
          </>
        )}
      </div>

      {/* 拖拽分隔线 */}
      {!leftCollapsed && (
        <div className="divider" style={styles.divider} onMouseDown={() => onMouseDown('left')} />
      )}

      {/* 中间浏览器面板 */}
      <div style={styles.center}>
        <ErrorBoundary panelName="Browser Panel">
          <BrowserPanel onResetLayout={handleResetLayout} />
        </ErrorBoundary>
      </div>

      {/* 拖拽分隔线 */}
      {!rightCollapsed && (
        <div className="divider" style={styles.divider} onMouseDown={() => onMouseDown('right')} />
      )}

      {/* 右侧状态面板 */}
      <div style={{ ...styles.panel, width: rightCollapsed ? COLLAPSED_WIDTH : rightWidth, flexShrink: 0, transition: 'width 0.2s ease' }}>
        {rightCollapsed ? (
          <div style={styles.collapsedPanel} onClick={toggleRightCollapse} title="展开面板">
            <span style={styles.collapsedLabel}>状态</span>
          </div>
        ) : (
          <>
            <div style={{ ...styles.tabBar, justifyContent: 'flex-end' }}>
              <button onClick={() => setDark(d => !d)} style={styles.themeBtn} title={dark ? '浅色模式' : '深色模式'}>
                {dark ? '☀' : '☾'}
              </button>
              <button onClick={toggleRightCollapse} style={styles.collapseBtn} title="折叠面板">»</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ErrorBoundary panelName="Queue Status Panel">
                <QueueStatusPanel />
              </ErrorBoundary>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    cursor: 'default',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  },
  panel: {
    height: '100%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-surface)',
    borderRight: '1px solid var(--color-border)',
  },
  center: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
    minWidth: 300,
    background: 'var(--color-bg)',
  },
  divider: {
    width: 'var(--divider-width)',
    height: '100%',
    background: 'var(--color-border)',
    cursor: 'col-resize',
    flexShrink: 0,
    transition: 'background var(--transition-fast)',
  },
  tabBar: {
    display: 'flex',
    background: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-border)',
    padding: '0 var(--space-1)',
    gap: 'var(--space-1)',
  },
  tab: {
    flex: 1,
    padding: '9px 0',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    outline: 'none',
    letterSpacing: 'var(--tracking-normal)',
    borderBottom: '2px solid transparent',
    transition: 'color var(--transition-fast), border-color var(--transition-fast)',
  },
  tabActive: {
    background: 'transparent',
    color: 'var(--color-text)',
    fontWeight: 600,
    borderBottom: '2px solid var(--color-accent)',
  },
  collapsedPanel: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: 'var(--color-header-bg)',
    borderRight: '1px solid var(--color-border)',
    userSelect: 'none',
  },
  collapsedLabel: {
    writingMode: 'vertical-rl',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    letterSpacing: 'var(--tracking-wide)',
    padding: 'var(--space-3) 0',
  },
  collapseBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    padding: '2px 8px',
    lineHeight: '1',
    flexShrink: 0,
  },
}

export default App
