import log from 'electron-log'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface LogEntry {
  timestamp: string
  taskId?: string
  module: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type LogListener = (entry: LogEntry) => void

export interface ILogger {
  info(module: string, message: string, taskId?: string): void
  warn(module: string, message: string, taskId?: string): void
  error(module: string, message: string, taskId?: string, error?: Error): void
  exportLogs(): Promise<string>
}

export class Logger implements ILogger {
  private listeners: Set<LogListener> = new Set()
  private _initialized = false

  private ensureInit(): void {
    if (this._initialized) return
    this._initialized = true

    log.transports.file.resolvePathFn = () =>
      path.join(app.getPath('userData'), 'logs', 'runway-desktop.log')
    log.transports.file.maxSize = 5 * 1024 * 1024
    log.transports.file.format =
      '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] [{processType}] {text}'
    if (!app.isPackaged) {
      log.transports.console.level = 'debug'
    }
  }

  addListener(fn: LogListener): void {
    this.listeners.add(fn)
  }

  removeListener(fn: LogListener): void {
    this.listeners.delete(fn)
  }

  private emit(entry: LogEntry): void {
    for (const fn of this.listeners) {
      try { fn(entry) } catch { /* silent */ }
    }
  }

  private formatMessage(module: string, message: string, taskId?: string): string {
    const taskPart = taskId ? `[${taskId}]` : ''
    return `[${module}] ${taskPart} ${message}`.trim()
  }

  info(module: string, message: string, taskId?: string): void {
    this.ensureInit()
    log.info(this.formatMessage(module, message, taskId))
    this.emit({ timestamp: new Date().toISOString(), taskId, module, level: 'info', message })
  }

  warn(module: string, message: string, taskId?: string): void {
    this.ensureInit()
    log.warn(this.formatMessage(module, message, taskId))
    this.emit({ timestamp: new Date().toISOString(), taskId, module, level: 'warn', message })
  }

  error(module: string, message: string, taskId?: string, error?: Error): void {
    this.ensureInit()
    const errDetail = error ? ` | ${error.message}` : ''
    log.error(this.formatMessage(module, message + errDetail, taskId))
    this.emit({ timestamp: new Date().toISOString(), taskId, module, level: 'error', message: message + errDetail })
  }

  async exportLogs(): Promise<string> {
    this.ensureInit()
    const exportDir = path.join(app.getPath('desktop'), 'runway-logs-export')
    await fs.promises.mkdir(exportDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const destPath = path.join(exportDir, `runway-log-${timestamp}.log`)
    const logDir = path.join(app.getPath('userData'), 'logs')
    const logFile = path.join(logDir, 'runway-desktop.log')
    try {
      const content = await fs.promises.readFile(logFile, 'utf-8')
      await fs.promises.writeFile(destPath, content, 'utf-8')
    } catch {
      // 日志文件不存在时不报错
    }
    return destPath
  }
}

export const logger = new Logger()
