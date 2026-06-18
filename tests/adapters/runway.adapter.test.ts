import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RunwayAdapter } from '../../src/adapters/runway.adapter'

// Mock electron clipboard module
vi.mock('electron', () => ({
  clipboard: {
    writeText: vi.fn(),
  },
}))

/** 创建 mock BrowserView */
function mockBrowserView() {
  const executeJavaScript = vi.fn()
  return {
    webContents: {
      executeJavaScript,
      openDevTools: vi.fn(),
      reload: vi.fn(),
      loadURL: vi.fn(),
      close: vi.fn(),
    },
    setBounds: vi.fn(),
    _js: executeJavaScript,
  }
}

describe('RunwayAdapter', () => {
  let adapter: RunwayAdapter
  let bv: ReturnType<typeof mockBrowserView>

  beforeEach(() => {
    adapter = new RunwayAdapter()
    bv = mockBrowserView()
    adapter.setBrowserView(bv as unknown as Electron.BrowserView)
  })

  describe('setBrowserView', () => {
    it('should throw if BrowserView not set', async () => {
      const a = new RunwayAdapter()
      await expect(a.selectModel('gen-4')).rejects.toThrow('BrowserView not set')
    })
  })

  describe('selectModel', () => {
    it('should click dropdown then find model option by text', async () => {
      bv._js
        // waitForSelector: found
        .mockResolvedValueOnce(true)
        // click dropdown
        .mockResolvedValueOnce(undefined)
        // clickOptionByTextJS: found and clicked
        .mockResolvedValueOnce(true)

      await adapter.selectModel('gen-4')

      const calls = bv._js.mock.calls.map((c: unknown[]) => c[0] as string)
      // call[0]: waitForSelector for model dropdown
      expect(calls[0]).toMatch(/querySelector/)
      // call[1]: clicks the dropdown
      expect(calls[1]).toContain('.click()')
      // call[2]: clickOptionByTextJS tries to find "Gen-4.5"
      expect(calls[2]).toContain('offsetParent')
    }, 15000)

    it('should throw if BrowserView not set', async () => {
      const a = new RunwayAdapter()
      await expect(a.selectModel('gen-4')).rejects.toThrow('BrowserView not set')
    })

    it('should retry and succeed if first attempt fails', async () => {
      bv._js
        // Attempt 1: waitForSelector fails
        .mockRejectedValueOnce(new Error('Temporary error'))
        // Attempt 2 (after 1s delay): waitForSelector succeeds
        .mockResolvedValueOnce(true)
        // click dropdown
        .mockResolvedValueOnce(undefined)
        // clickOptionByTextJS succeeds
        .mockResolvedValueOnce(true)

      await expect(adapter.selectModel('gen-4')).resolves.toBeUndefined()
    }, 15000)
  })

  describe('fillPrompt', () => {
    it('should write prompt to clipboard and execute JS', async () => {
      bv._js.mockResolvedValueOnce(true)

      await adapter.fillPrompt('a cat walking')

      // Should have called executeJavaScript
      expect(bv._js).toHaveBeenCalled()
      const call = bv._js.mock.calls[0][0] as string
      expect(call).toContain('a cat walking')
    })

    it('should still succeed even if input element not found (fallback path)', async () => {
      bv._js.mockResolvedValueOnce(true)

      await expect(adapter.fillPrompt('test')).resolves.toBeUndefined()
    })
  })

  describe('clickGenerate', () => {
    it('should click generate button by text', async () => {
      bv._js.mockResolvedValueOnce(true)

      await adapter.clickGenerate()

      const call = bv._js.mock.calls[0][0] as string
      expect(call).toContain('Generate')
      expect(call).toContain('btn.click')
    })

    it('should throw if generate button not found', async () => {
      bv._js.mockResolvedValue(false)

      await expect(adapter.clickGenerate()).rejects.toThrow('Generate button not found')
    }, 30000)
  })

  describe('checkStatus', () => {
    it('should return idle when no indicators', async () => {
      bv._js.mockResolvedValueOnce('idle')
      const status = await adapter.checkStatus()
      expect(status).toBe('idle')
    })

    it('should return completed when video element found', async () => {
      bv._js.mockResolvedValueOnce('completed')
      const status = await adapter.checkStatus()
      expect(status).toBe('completed')
    })

    it('should return generating when in progress', async () => {
      bv._js.mockResolvedValueOnce('generating')
      const status = await adapter.checkStatus()
      expect(status).toBe('generating')
    })
  })

  describe('waitForCompletion', () => {
    it('should resolve when status becomes completed', async () => {
      bv._js
        .mockResolvedValueOnce('generating')
        .mockResolvedValueOnce('generating')
        .mockResolvedValueOnce('completed')
        // 获取视频 URL
        .mockResolvedValueOnce('https://runwayml.com/video/123.mp4')

      const result = await adapter.waitForCompletion()
      expect(result.status).toBe('completed')
      expect(result.videoUrl).toBe('https://runwayml.com/video/123.mp4')
    })

    it('should fail after 3 consecutive errors', async () => {
      bv._js.mockRejectedValue(new Error('Connection lost'))

      const result = await adapter.waitForCompletion()
      expect(result.status).toBe('failed')
      expect(result.error).toContain('Repeated check failures')
    })
  })
})
