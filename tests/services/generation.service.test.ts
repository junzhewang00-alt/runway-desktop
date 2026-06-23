import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/database/connection', () => ({
  databaseConnection: { getDb: () => ({ prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 1 }) }) }) },
}))

vi.mock('../../src/database/history.store', () => ({
  historyStore: { insert: vi.fn() },
}))

vi.mock('../../src/database/material.store', () => ({
  materialStore: { getByIds: vi.fn(() => []) },
}))

vi.mock('../../src/queue/task.queue', () => ({
  taskQueue: {
    create: vi.fn(() => ({ id: 'task-1', prompt: 'test', modelId: 'gen-4.5', status: 'pending', priority: 'medium', retryCount: 0 })),
    getById: vi.fn(),
    list: vi.fn(() => []),
    updateStatus: vi.fn(),
    delete: vi.fn(),
    notifySlotFreed: vi.fn(),
  },
}))

vi.mock('../../src/adapters/runway.adapter', () => ({
  runwayAdapter: { restoreSlotState: vi.fn(), getAvailableSlots: () => 2 },
}))

vi.mock('../../src/download/download.manager', () => ({
  downloadManager: { download: vi.fn(), setLogger: vi.fn() },
}))

vi.mock('../../src/services/notification.service', () => ({
  notificationService: {
    notifyTaskComplete: vi.fn(),
    notifyTaskFailed: vi.fn(),
  },
}))

vi.mock('../../src/logs/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GenerationService } from '../../src/services/generation.service'
import { taskQueue } from '../../src/queue/task.queue'
import { historyStore } from '../../src/database/history.store'
import { downloadManager } from '../../src/download/download.manager'
import { notificationService } from '../../src/services/notification.service'

describe('GenerationService', () => {
  let service: GenerationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new GenerationService()
    service.setLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), exportLogs: async () => '' })
    service.setAdapter({
      submitOnly: vi.fn(),
      resetPage: vi.fn(),
      selectModel: vi.fn(),
      fillPrompt: vi.fn(),
      clickGenerate: vi.fn(),
      checkStatus: vi.fn(),
      waitForCompletion: vi.fn(),
      setBrowserView: vi.fn(),
      setCompletionCallback: vi.fn(),
      setSlotFreedCallback: vi.fn(),
      setMonitorBlockedCallback: vi.fn(),
      startPersistentMonitor: vi.fn(),
      stopPersistentMonitor: vi.fn(),
      diagnosePage: vi.fn(),
      getAvailableSlots: () => 2,
    })
  })

  describe('enqueueGeneration', () => {
    it('should create a task via queue', async () => {
      const task = await service.enqueueGeneration({ prompt: 'hello', modelId: 'gen-4.5' })
      expect(task.id).toBe('task-1')
      expect(taskQueue.create).toHaveBeenCalledWith({ prompt: 'hello', modelId: 'gen-4.5' })
    })
  })

  describe('handleCompletion', () => {
    it('should record completed task in history and trigger download', () => {
      const mockTask = { id: 'task-1', prompt: 'test', modelId: 'gen-4.5', status: 'running', priority: 'medium' as const, note: '', retryCount: 0, createdAt: 0, updatedAt: 0, duration: 5, resolution: '720p', aspectRatio: '16:9' }
      vi.mocked(taskQueue.getById).mockReturnValue(mockTask)

      service.handleCompletion('task-1', { status: 'completed', videoUrl: 'https://example.com/video.mp4' })

      expect(taskQueue.updateStatus).toHaveBeenCalledWith('task-1', 'completed')
      expect(historyStore.insert).toHaveBeenCalled()
      expect(downloadManager.download).toHaveBeenCalledWith('task-1', 'https://example.com/video.mp4')
      expect(notificationService.notifyTaskComplete).toHaveBeenCalled()
    })

    it('should auto-retry on failure if retries remain', () => {
      const mockTask = { id: 'task-1', prompt: 'test', modelId: 'gen-4.5', status: 'running', priority: 'medium' as const, note: '', retryCount: 0, createdAt: 0, updatedAt: 0 }
      vi.mocked(taskQueue.getById).mockReturnValue(mockTask)

      service.handleCompletion('task-1', { status: 'failed', error: 'Server overload' })

      expect(taskQueue.updateStatus).toHaveBeenCalledWith('task-1', 'pending', 'Server overload')
    })

    it('should mark as failed when retries exhausted', () => {
      const mockTask = { id: 'task-1', prompt: 'test', modelId: 'gen-4.5', status: 'running', priority: 'medium' as const, note: '', retryCount: 3, createdAt: 0, updatedAt: 0 }
      vi.mocked(taskQueue.getById).mockReturnValue(mockTask)

      service.handleCompletion('task-1', { status: 'failed', error: 'Permanent error' })

      expect(taskQueue.updateStatus).toHaveBeenCalledWith('task-1', 'failed', 'Permanent error')
    })

    it('should handle task not found gracefully', () => {
      vi.mocked(taskQueue.getById).mockReturnValue(null)
      expect(() => service.handleCompletion('nonexistent', { status: 'completed' })).not.toThrow()
    })
  })
})
