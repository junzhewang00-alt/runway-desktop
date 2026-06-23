import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  net: { request: vi.fn(() => ({ on: vi.fn(), end: vi.fn() })) },
}))

vi.mock('../../src/logs/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 0 })),
  createWriteStream: vi.fn(() => ({ on: vi.fn(), write: vi.fn(() => true), close: vi.fn() })),
  renameSync: vi.fn(),
}))

import { DownloadManager } from '../../src/download/download.manager'

describe('DownloadManager', () => {
  let dm: DownloadManager

  beforeEach(() => {
    vi.clearAllMocks()
    dm = new DownloadManager()
    dm.setLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), exportLogs: async () => '' })
  })

  describe('getProgress', () => {
    it('should return null for unknown task', () => {
      expect(dm.getProgress('unknown')).toBeNull()
    })
  })

  describe('cancel', () => {
    it('should not throw for unknown task', () => {
      expect(() => dm.cancel('unknown')).not.toThrow()
    })
  })
})
