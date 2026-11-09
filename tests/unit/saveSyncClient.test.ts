// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../app/utils/cloudApi'
import { createSaveSync } from '../../app/utils/saveSyncClient'
import { deriveSaveKeys, fingerprint, sealSave, type SyncMeta } from '../../shared/utils/saveSync'
import { newGameKey } from '../../shared/utils/chunkCrypto'

const card = (n: number) => new Uint8Array(128).fill(n)
const PATH = '/data/saves/PCSX-ReARMed/game.srm'

function fakeFs(initial: Uint8Array | null) {
  const files = new Map<string, Uint8Array>()
  if (initial) files.set(PATH, initial)
  return {
    files,
    analyzePath: (p: string) => ({ exists: files.has(p) }),
    readFile: (p: string) => files.get(p)!,
    writeFile: (p: string, d: Uint8Array) => void files.set(p, d),
    mkdir: () => {},
  }
}

function setup(opts: { cloud?: Uint8Array | null; meta?: SyncMeta | null; failPut?: number } = {}) {
  const kGame = newGameKey()
  const store = { cloud: opts.cloud ?? null as Uint8Array | null, puts: [] as Uint8Array[], failPut: opts.failPut ?? 0, gate: null as null | Promise<void> }
  let meta = opts.meta ?? null
  const api = {
    getSave: vi.fn(async () => store.cloud),
    putSave: vi.fn(async (_k: string, b: Uint8Array) => {
      if (store.gate) await store.gate
      if (store.failPut > 0) { store.failPut--; throw new TypeError('Failed to fetch') }
      store.puts.push(b); store.cloud = b
    }),
  }
  const sync = createSaveSync({ api, kGame, getMeta: async () => meta, setMeta: async (_k, m) => void (meta = m), now: () => 1000 })
  return { kGame, store, api, sync, meta: () => meta }
}

async function sealed(kGame: Uint8Array, c: Uint8Array, t: number) {
  const { saveKey, key } = await deriveSaveKeys(kGame)
  return sealSave(key, saveKey, c, t)
}

describe('createSaveSync', () => {
  it('new device: pulls the cloud card into the FS before the core boots', async () => {
    const s = setup()
    s.store.cloud = await sealed(s.kGame, card(7), 50)
    await s.sync.prepare()
    const fs = fakeFs(null)
    expect(s.sync.onFsReady(fs, PATH).action).toBe('pull')
    expect(fs.files.get(PATH)).toEqual(card(7))
    await vi.waitFor(() => expect(s.meta()).toEqual({ updatedAt: 50, hash: fingerprint(card(7)) }))
  })

  it('conflict: injects the cloud card and hands back the local one', async () => {
    const s = setup({ meta: { updatedAt: 1, hash: fingerprint(card(1)) } })
    s.store.cloud = await sealed(s.kGame, card(2), 60)
    await s.sync.prepare()
    const fs = fakeFs(card(3))
    const r = s.sync.onFsReady(fs, PATH)
    expect(r.action).toBe('conflict')
    expect(r.keepLocal).toEqual(card(3))
    expect(fs.files.get(PATH)).toEqual(card(2))
  })

  it('local only: pushes it after start', async () => {
    const s = setup()
    await s.sync.prepare()
    expect(s.sync.onFsReady(fakeFs(card(4)), PATH).action).toBe('push')
    await vi.waitFor(() => expect(s.store.puts).toHaveLength(1))
    expect(s.sync.status.value).toBe('synced')
  })

  it('saves are single-flight: a second save while a PUT is pending ends with exactly two PUTs, last card wins', async () => {
    const s = setup()
    await s.sync.prepare()
    s.sync.onFsReady(fakeFs(null), PATH)
    let release!: () => void
    s.store.gate = new Promise((r) => (release = r))
    s.sync.onCardSaved(card(1))
    s.sync.onCardSaved(card(2))
    s.sync.onCardSaved(card(3))
    s.store.gate = null
    release()
    await vi.waitFor(() => expect(s.sync.status.value).toBe('synced'))
    await new Promise((r) => setTimeout(r, 20))
    expect(s.store.puts).toHaveLength(2)
    const { saveKey, key } = await deriveSaveKeys(s.kGame)
    const { openSave } = await import('../../shared/utils/saveSync')
    expect((await openSave(key, saveKey, s.store.cloud!)).card).toEqual(card(3))
  })

  it('unchanged card is not uploaded again', async () => {
    const s = setup()
    await s.sync.prepare()
    s.sync.onFsReady(fakeFs(null), PATH)
    s.sync.onCardSaved(card(1))
    await vi.waitFor(() => expect(s.store.puts).toHaveLength(1))
    s.sync.onCardSaved(card(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(s.store.puts).toHaveLength(1)
  })

  it('offline: status offline, next save retries and syncs', async () => {
    const s = setup({ failPut: 1 })
    await s.sync.prepare()
    s.sync.onFsReady(fakeFs(null), PATH)
    s.sync.onCardSaved(card(5))
    await vi.waitFor(() => expect(s.sync.status.value).toBe('offline'))
    s.sync.onCardSaved(card(5))
    await vi.waitFor(() => expect(s.sync.status.value).toBe('synced'))
  })

  it('prepare offline or a tampered cloud save: starts with the local card and reports it', async () => {
    const s = setup()
    s.api.getSave.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await s.sync.prepare()
    const fs = fakeFs(card(9))
    expect(s.sync.onFsReady(fs, PATH).action).toBe('none')
    expect(fs.files.get(PATH)).toEqual(card(9))
    expect(s.sync.status.value).toBe('offline')

    // Cloud state unknown: saves made while playing must not overwrite a possibly newer cloud card.
    s.sync.onCardSaved(card(10))
    await new Promise((r) => setTimeout(r, 20))
    expect(s.store.puts).toHaveLength(0)
    expect(s.sync.status.value).toBe('offline')

    // A damaged cloud save is replaced by the local card (repair), after reporting it.
    const t = setup()
    const bad = await sealed(t.kGame, card(1), 5); bad[30]! ^= 1
    t.store.cloud = bad
    await t.sync.prepare()
    expect(t.sync.status.value).toBe('error')
    expect(t.sync.onFsReady(fakeFs(card(9)), PATH).action).toBe('push')
    await vi.waitFor(() => expect(t.store.puts).toHaveLength(1))
  })

  it('a 404 from getSave just means no cloud save yet', async () => {
    const s = setup()
    s.api.getSave.mockRejectedValueOnce(new ApiError(404))
    await s.sync.prepare()
    expect(s.sync.onFsReady(fakeFs(null), PATH).action).toBe('none')
    expect(s.sync.status.value).toBe('idle')
  })
})
