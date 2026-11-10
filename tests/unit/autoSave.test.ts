import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoSave, type Snapshot } from '../../app/utils/autoSave'

const snap: Snapshot = { state: new Uint8Array([1, 2, 3]), screenshot: null }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createAutoSave', () => {
  it('saves every interval while not idle', async () => {
    const save = vi.fn(async () => true)
    let idle = false
    const a = createAutoSave({ capture: async () => snap, save, idle: () => idle, intervalMs: 1000 })
    a.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    idle = true
    await vi.advanceTimersByTimeAsync(3000)
    expect(save).toHaveBeenCalledTimes(1)
    a.stop()
  })

  it('shares one in-flight save between callers', async () => {
    let release!: () => void
    const save = vi.fn(() => new Promise<boolean>((r) => (release = () => r(true))))
    const a = createAutoSave({ capture: async () => snap, save })
    const p1 = a.run()
    const p2 = a.run()
    await vi.advanceTimersByTimeAsync(0)
    release()
    expect(await p1).toBe(true)
    expect(await p2).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('nothing to capture → no upload, false', async () => {
    const save = vi.fn(async () => true)
    const a = createAutoSave({ capture: async () => null, save })
    expect(await a.run()).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('a failing capture or upload never throws', async () => {
    const a = createAutoSave({ capture: async () => { throw new Error('core busy') }, save: async () => true })
    expect(await a.run()).toBe(false)
    const b = createAutoSave({ capture: async () => snap, save: async () => { throw new Error('offline') } })
    expect(await b.run()).toBe(false)
  })

  it('runWithin stops waiting after the limit (exit must not hang)', async () => {
    const a = createAutoSave({ capture: async () => snap, save: () => new Promise<boolean>(() => {}) })
    const p = a.runWithin(8000)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await p).toBe(false)
  })

  it('records when the last save succeeded', async () => {
    const a = createAutoSave({ capture: async () => snap, save: async () => true, now: () => 42 })
    expect(a.lastSavedAt()).toBeNull()
    await a.run()
    expect(a.lastSavedAt()).toBe(42)
  })
})
