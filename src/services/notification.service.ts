import { Notification } from 'electron'
import type { ILogger } from '../logs/logger'

export interface INotificationService {
  notifyTaskComplete(modelName: string, promptPreview: string): void
  notifyTaskFailed(modelName: string, error: string): void
}

export class NotificationService implements INotificationService {
  private logger: ILogger | null = null

  setLogger(logger: ILogger): void {
    this.logger = logger
  }

  notifyTaskComplete(modelName: string, promptPreview: string): void {
    try {
      new Notification({ title: `生成完成 — ${modelName}`, body: promptPreview }).show()
    } catch {
      this.logger?.warn('Notification', 'Failed to show completion notification')
    }
  }

  notifyTaskFailed(modelName: string, error: string): void {
    try {
      new Notification({ title: `生成失败 — ${modelName}`, body: error || '未知错误' }).show()
    } catch {
      this.logger?.warn('Notification', 'Failed to show failure notification')
    }
  }
}

export const notificationService = new NotificationService()
