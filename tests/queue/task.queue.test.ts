import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must mock BEFORE importing TaskQueue
vi.mock('../../src/database/connection', () => ({
  databaseConnection: {
    getDb: () => ({
      prepare: () => ({
        get: () => undefined,
        all: () => [],
        run: () => ({ changes: 1 }),
      }),
    }),
  },
}))

vi.mock('../../src/database/material.store', () => ({
  materialStore: { getByIds: () => [] },
}))

vi.mock('../../src/adapters/runway.adapter', () => ({
  runwayAdapter: {
    restoreSlotState: vi.fn(),
    getAvailableSlots: () => 2,
  },
}))

vi.mock('../../src/logs/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { TaskQueue } from '../../src/queue/task.queue'

describe('TaskQueue', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
    queue.setSlotChecker(() => 2)
    queue.setProcessor(async () => {})
  })

  describe('create', () => {
    it('should create a task with required fields', () => {
      const task = queue.create({ prompt: 'test prompt', modelId: 'gen-4.5' })
      expect(task.id).toBeDefined()
      expect(task.prompt).toBe('test prompt')
      expect(task.modelId).toBe('gen-4.5')
      expect(task.status).toBe('pending')
      expect(task.priority).toBe('medium')
    })

    it('should create a task with optional fields', () => {
      const task = queue.create({
        prompt: 'test', modelId: 'gen-4.5', priority: 'high',
        note: 'test note', duration: 10, resolution: '1080p', aspectRatio: '16:9',
      })
      expect(task.priority).toBe('high')
      expect(task.duration).toBe(10)
      expect(task.resolution).toBe('1080p')
      expect(task.aspectRatio).toBe('16:9')
    })

    it('should generate unique IDs', () => {
      const t1 = queue.create({ prompt: 'a', modelId: 'gen-4.5' })
      const t2 = queue.create({ prompt: 'b', modelId: 'gen-4.5' })
      expect(t1.id).not.toBe(t2.id)
    })

    it('should set timestamps', () => {
      const task = queue.create({ prompt: 'test', modelId: 'gen-4.5' })
      expect(task.createdAt).toBeGreaterThan(0)
      expect(task.updatedAt).toBeGreaterThan(0)
    })

    it('should default retryCount to 0', () => {
      const task = queue.create({ prompt: 'test', modelId: 'gen-4.5' })
      expect(task.retryCount).toBe(0)
    })
  })
})
