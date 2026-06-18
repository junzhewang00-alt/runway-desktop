import { useEffect, useRef, useState } from 'react'

interface BrowserPanelProps {
  onResetLayout?: () => void
}

const BrowserPanel: React.FC<BrowserPanelProps> = ({ onResetLayout }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // 同步 BrowserView bounds 到中间面板的实际 DOM 位置
  useEffect(() => {
    const syncBounds = () => {
      if (!viewportRef.current) return
      const rect = viewportRef.current.getBoundingClientRect()
      window.electronAPI.browser.updateBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    // 初次同步（等 DOM 渲染完成）
    const timer = setTimeout(syncBounds, 100)

    // 监听窗口 resize
    const observer = new ResizeObserver(syncBounds)
    if (viewportRef.current) {
      observer.observe(viewportRef.current)
    }

    window.addEventListener('resize', syncBounds)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [])

  useEffect(() => {
    window.electronAPI.session.isLoggedIn().then(setIsLoggedIn)
    const timer = setInterval(() => {
      window.electronAPI.session.isLoggedIn().then(setIsLoggedIn)
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    return window.electronAPI.shortcuts.onRefreshBrowser(() => {
      window.electronAPI.browser.refresh()
    })
  }, [])

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <span style={styles.label}>Runway</span>
        <span
          style={{
            ...styles.status,
            color: isLoggedIn ? '#5cb85c' : '#999',
          }}
        >
          {isLoggedIn ? 'Logged in' : isLoggedIn === false ? 'Not logged in' : 'Checking...'}
        </span>
        <div style={styles.actions}>
          <button
            onClick={() => window.electronAPI.browser.refresh()}
            style={styles.btn}
            title="刷新"
          >
            刷新
          </button>
          <button
            onClick={() => window.electronAPI.browser.openDevTools()}
            style={styles.btn}
            title="开发者工具"
          >
            开发者工具
          </button>
          <button
            onClick={async () => {
              const data = await window.electronAPI.debug.diagnose()
              console.log('=== RUNWAY PAGE ELEMENTS ===')
              console.log(data)
              alert('已输出到控制台，请按 Ctrl+Shift+I 打开 DevTools 查看 Console')
            }}
            style={{ ...styles.btn, background: 'var(--color-warning-bg)', borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
            title="诊断页面元素"
          >
            🔍 诊断
          </button>
          {onResetLayout && (
            <button
              onClick={onResetLayout}
              style={{ ...styles.btn, background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
              title="重置左右面板到默认宽度"
            >
              重置布局
            </button>
          )}
        </div>
      </div>
      {/* BrowserView 覆盖这个 viewport 区域 */}
      <div ref={viewportRef} style={styles.viewport} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--color-bg)',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    padding: 'var(--space-2) var(--space-5)',
    background: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-border)',
    minHeight: 36,
    flexShrink: 0,
  },
  label: {
    fontSize: 'var(--text-base)',
    fontWeight: 600,
    color: 'var(--color-text)',
    letterSpacing: 'var(--tracking-tight)',
  },
  status: {
    fontSize: 'var(--text-xs)',
    flex: 1,
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-2)',
  },
  btn: {
    padding: '4px 12px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
  },
  viewport: {
    flex: 1,
    background: 'var(--color-bg)',
  },
}

export default BrowserPanel
