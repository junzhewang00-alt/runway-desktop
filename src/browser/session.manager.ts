import { session } from 'electron'

const PARTITION = 'persist:runway-session'
const RUNWAY_DOMAIN = '.runwayml.com'

export class SessionManager {
  private _ses: Electron.Session | null = null

  private get ses(): Electron.Session {
    if (!this._ses) {
      try {
        this._ses = session.fromPartition(PARTITION)
        this._ses.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`Failed to create session (app may be shutting down): ${msg}`)
      }
    }
    return this._ses
  }

  getSession(): Electron.Session {
    return this.ses
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const cookies = await this.ses.cookies.get({ domain: RUNWAY_DOMAIN })
      const now = Date.now() / 1000
      return cookies.some((c) => !c.expirationDate || c.expirationDate > now)
    } catch {
      return false
    }
  }

  async clearSession(): Promise<void> {
    await this.ses.clearStorageData({
      origin: 'https://app.runwayml.com',
      storages: ['cookies', 'localstorage', 'indexdb'],
    })
  }
}

export const sessionManager = new SessionManager()
