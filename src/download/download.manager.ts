import { app, net, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import type { ILogger } from '../logs/logger'

export interface DownloadProgress {
  taskId: string
  downloadedBytes: number
  totalBytes: number
  percent: number
}

export interface IDownloadManager {
  download(taskId: string, videoUrl: string): void
  cancel(taskId: string): void
  getProgress(taskId: string): DownloadProgress | null
}

export class DownloadManager implements IDownloadManager {
  private logger: ILogger | null = null
  private active = new Map<string, { request: Electron.ClientRequest; destPath: string }>()
  private progress = new Map<string, DownloadProgress>()

  private static readonly DOWNLOAD_TIMEOUT = 600_000
  private static readonly MAX_RETRIES = 3

  setLogger(logger: ILogger): void {
    this.logger = logger
  }

  download(taskId: string, videoUrl: string, retryCount = 0): void {
    try {
      const downloadsDir = path.join(app.getPath('downloads'), 'runway-desktop')
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true })
      }

      const ext = videoUrl.match(/\.(mp4|webm|mov)(\?|$)/i)?.[1] || 'mp4'
      const filename = `${taskId.slice(0, 8)}.${ext}`
      const destPath = path.join(downloadsDir, filename)
      const tempPath = destPath + '.part'

      const resumePath = fs.existsSync(tempPath) ? tempPath
        : fs.existsSync(destPath) ? destPath
        : null
      const downloadedBytes = resumePath ? fs.statSync(resumePath).size : 0

      let timedOut = false
      const request = net.request({
        url: videoUrl,
        ...(downloadedBytes > 0 ? { headers: { Range: `bytes=${downloadedBytes}-` } } : {}),
      })

      this.active.set(taskId, { request, destPath })

      const timeoutId = setTimeout(() => {
        timedOut = true
        request.abort()
        this.logger?.warn('Download', `Timeout after ${DownloadManager.DOWNLOAD_TIMEOUT / 1000}s: ${taskId}`, taskId)
      }, DownloadManager.DOWNLOAD_TIMEOUT)

      this.progress.set(taskId, { taskId, downloadedBytes, totalBytes: 0, percent: 0 })

      request.on('response', (response) => {
        if (timedOut) return

        const isResume = response.statusCode === 206
        const flags = isResume || downloadedBytes > 0 ? 'a' : 'w'
        const fileStream = fs.createWriteStream(resumePath || tempPath, { flags })

        const contentLength = parseInt(response.headers['content-length'] as string || '0', 10)
        const totalBytes = downloadedBytes + (contentLength || 0)
        this.progress.set(taskId, { taskId, downloadedBytes, totalBytes, percent: downloadedBytes > 0 && totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0 })

        if (downloadedBytes > 0) {
          this.logger?.info('Download', `Resuming from byte ${downloadedBytes} (${isResume ? 'Range OK' : 'server ignored Range'})`, taskId)
        }

        let written = downloadedBytes
        response.on('data', (chunk: Buffer) => {
          const ok = fileStream.write(chunk)
          if (!ok) {
            response.pause()
            fileStream.once('drain', () => response.resume())
          }
          written += chunk.length
          const pct = totalBytes > 0 ? Math.round((written / totalBytes) * 100) : 0
          this.progress.set(taskId, { taskId, downloadedBytes: written, totalBytes, percent: pct })
        })

        response.on('end', () => {
          clearTimeout(timeoutId)
          fileStream.close()
          this.active.delete(taskId)

          const finalPath = destPath
          if (resumePath || tempPath !== destPath) {
            try { fs.renameSync(resumePath || tempPath, finalPath) } catch { /* already renamed */ }
          }
          this.progress.set(taskId, { taskId, downloadedBytes: totalBytes || written, totalBytes: totalBytes || written, percent: 100 })
          this.logger?.info('Download', `Complete: ${finalPath} (${downloadedBytes > 0 ? 'resumed' : 'fresh'})`, taskId)
        })

        response.on('error', (err: Error) => {
          clearTimeout(timeoutId)
          fileStream.close()
          this.active.delete(taskId)
          this.logger?.error('Download', `Error (partial kept): ${err.message}`, taskId)
          if (retryCount < DownloadManager.MAX_RETRIES) {
            this.download(taskId, videoUrl, retryCount + 1)
          }
        })
      })

      request.on('error', (err: Error) => {
        clearTimeout(timeoutId)
        this.active.delete(taskId)
        this.logger?.error('Download', `Request error (partial kept): ${err.message}`, taskId)
        if (retryCount < DownloadManager.MAX_RETRIES) {
          this.download(taskId, videoUrl, retryCount + 1)
        }
      })

      request.end()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger?.error('Download', `Setup error: ${msg}`, taskId)
    }
  }

  cancel(taskId: string): void {
    const entry = this.active.get(taskId)
    if (entry) {
      entry.request.abort()
      this.active.delete(taskId)
      this.logger?.info('Download', `Cancelled: ${taskId}`, taskId)
    }
  }

  getProgress(taskId: string): DownloadProgress | null {
    return this.progress.get(taskId) ?? null
  }
}

export const downloadManager = new DownloadManager()
