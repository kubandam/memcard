// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('getRequestURL', () => new URL('https://memcard.devffice.com/api/lib/x/objects/y'))
const { edgeGet, edgePut } = await import('../../server/utils/edgeCache')

function fakeCaches() {
  const store = new Map<string, Response>()
  const waits: Promise<unknown>[] = []
  vi.stubGlobal('caches', {
    default: {
      match: async (k: string) => store.get(k)?.clone(),
      put: async (k: string, r: Response) => void store.set(k, r),
    },
  })
  const event = { context: { cloudflare: { context: { waitUntil: (p: Promise<unknown>) => waits.push(p) } } } } as never
  return { store, waits, event }
}

afterEach(() => vi.unstubAllGlobals())

describe('edge cache for encrypted ranges', () => {
  it('stores a range and serves it back with its content-range', async () => {
    vi.stubGlobal('getRequestURL', () => new URL('https://memcard.devffice.com/x'))
    const { store, waits, event } = fakeCaches()
    const bytes = new Uint8Array([1, 2, 3, 4])
    edgePut(event, 'lib1', 'obj1', 0, 3, { bytes, contentRange: 'bytes 0-3/10', size: 10 })
    await Promise.all(waits)
    expect([...store.keys()]).toEqual(['https://memcard.devffice.com/__edge/lib/lib1/obj/obj1/0-3'])
    const hit = await edgeGet(event, 'lib1', 'obj1', 0, 3)
    expect(hit).toEqual({ bytes, contentRange: 'bytes 0-3/10', size: 10 })
  })

  it('keys by library, object and range', async () => {
    vi.stubGlobal('getRequestURL', () => new URL('https://memcard.devffice.com/x'))
    const { waits, event } = fakeCaches()
    edgePut(event, 'lib1', 'obj1', 0, 3, { bytes: new Uint8Array(4), contentRange: 'bytes 0-3/10', size: 10 })
    await Promise.all(waits)
    expect(await edgeGet(event, 'lib2', 'obj1', 0, 3)).toBeNull()
    expect(await edgeGet(event, 'lib1', 'obj2', 0, 3)).toBeNull()
    expect(await edgeGet(event, 'lib1', 'obj1', 4, 7)).toBeNull()
  })

  it('is a no-op where the Cache API does not exist', async () => {
    vi.stubGlobal('getRequestURL', () => new URL('https://memcard.devffice.com/x'))
    vi.stubGlobal('caches', undefined)
    const event = { context: {} } as never
    edgePut(event, 'l', 'o', 0, 1, { bytes: new Uint8Array(2), contentRange: 'bytes 0-1/2', size: 2 })
    expect(await edgeGet(event, 'l', 'o', 0, 1)).toBeNull()
  })
})
