import { BrowserView, BrowserWindow } from 'electron'
import path from 'path'
import type { SessionManager } from './session.manager'
import { getRunwayURL, getRunwayTeamSlug } from '../adapters/runway.selectors'
import { logger } from '../logs/logger'

export interface IBrowserManager {
  loadURL(url: string): Promise<void>
  reload(): void
  openDevTools(): void
  setBounds(x: number, y: number, width: number, height: number): void
  destroy(): void
  getBrowserView(): BrowserView
}

export class BrowserManager implements IBrowserManager {
  private browserView: BrowserView | null = null
  private hostWindow: BrowserWindow | null = null
  private sessionManager: SessionManager | null = null
  private initialBounds: { x: number; y: number; width: number; height: number } | undefined
  private onRebuild: ((bv: BrowserView) => void) | null = null
  private destroying = false
  private savedBounds: { x: number; y: number; width: number; height: number } | null = null
  private onHostClosed: (() => void) | null = null

  static get RUNWAY_URL(): string {
    return getRunwayURL({ newSession: 'true' })
  }

  /** 注入 SessionManager（Sprint 3：依赖注入） */
  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm
  }

  setOnRebuild(callback: (bv: BrowserView) => void): void {
    this.onRebuild = callback
  }

  /** 创建 BrowserView 并附加到主窗口 */
  attachTo(hostWindow: BrowserWindow, initialBounds?: { x: number; y: number; width: number; height: number }): void {
    if (this.browserView) {
      this.destroy()
    }

    this.hostWindow = hostWindow
    this.initialBounds = initialBounds

    const ses = this.sessionManager?.getSession()
    if (!ses) {
      throw new Error('SessionManager not set. Call setSessionManager() before attachTo().')
    }

    this.browserView = new BrowserView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '../preload/browser-preload.js'),
      },
    })

    hostWindow.setBrowserView(this.browserView)

    if (initialBounds) {
      this.browserView.setBounds(initialBounds)
    }

    this.browserView.webContents.on('crashed', (_event, killed) => {
      console.error(`BrowserView crashed (killed=${killed})`)
      this.rebuildBrowserView()
    })

    this.browserView.webContents.on('destroyed', () => {
      if (!this.destroying && this.browserView) {
        this.rebuildBrowserView()
      }
    })

    // 窗口关闭时自动销毁（先移除旧 listener 防止重复注册）
    if (this.onHostClosed) {
      hostWindow.removeListener('closed', this.onHostClosed)
    }
    this.onHostClosed = () => { this.destroy() }
    hostWindow.on('closed', this.onHostClosed)
  }

  private rebuildBrowserView(): void {
    if (!this.hostWindow) return

    this.browserView = null
    // setBrowserView(null) 移除旧 BrowserView；Electron 类型定义限制需显式断言
    ;(this.hostWindow.setBrowserView as (bv: BrowserView | null) => void)(null)

    this.attachTo(this.hostWindow, this.initialBounds)
    this.loadURL(BrowserManager.RUNWAY_URL)

    if (this.onRebuild && this.browserView) {
      this.onRebuild(this.browserView)
    }
  }

  async loadURL(url: string): Promise<void> {
    if (!this.browserView) {
      throw new Error('BrowserView not initialized. Call attachTo() first.')
    }
    await this.browserView.webContents.loadURL(url)
  }

  reload(): void {
    if (!this.browserView) {
      throw new Error('BrowserView not initialized.')
    }
    this.browserView.webContents.reload()
  }

  openDevTools(): void {
    if (!this.browserView) {
      throw new Error('BrowserView not initialized.')
    }
    this.browserView.webContents.openDevTools()
  }

  setBounds(x: number, y: number, width: number, height: number): void {
    if (!this.browserView) {
      throw new Error('BrowserView not initialized.')
    }
    this.browserView.setBounds({ x, y, width, height })
  }

  /** 弹窗打开时移除 BrowserView（避免遮挡 React UI），关闭时恢复 */
  hide(): void {
    if (!this.browserView || !this.hostWindow) return
    try {
      this.savedBounds = this.browserView.getBounds()
      this.hostWindow.removeBrowserView(this.browserView)
    } catch { /* ignore */ }
  }

  /** 弹窗关闭时恢复 BrowserView */
  show(): void {
    if (!this.browserView || !this.hostWindow) return
    try {
      this.hostWindow.addBrowserView(this.browserView)
      if (this.savedBounds) {
        this.browserView.setBounds(this.savedBounds)
        this.savedBounds = null
      }
    } catch { /* ignore */ }
  }

  destroy(): void {
    this.destroying = true
    if (this.browserView && this.hostWindow) {
      if (this.onHostClosed && !this.hostWindow.isDestroyed()) {
        try { this.hostWindow.removeListener('closed', this.onHostClosed) } catch { /* ignore */ }
      }
      this.onHostClosed = null
      if (!this.hostWindow.isDestroyed()) {
        try { this.hostWindow.removeBrowserView(this.browserView) } catch { /* window closing */ }
      }
      try { this.browserView.webContents.close() } catch { /* already closed */ }
      this.browserView = null
    }

    this.hostWindow = null
    this.destroying = false
  }

  getBrowserView(): BrowserView {
    if (!this.browserView) {
      throw new Error('BrowserView not initialized. Call attachTo() first.')
    }
    return this.browserView
  }
}

/** 单例 */
export const browserManager = new BrowserManager()
