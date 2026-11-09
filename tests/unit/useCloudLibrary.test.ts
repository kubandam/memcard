// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../app/utils/cloudApi'
import { __resetCloudForTests, __setCloudApiFactory, useCloudLibrary, SESSION_KEY } from '../../app/composables/useCloudLibrary'
import { __resetDbForTests } from '../../app/utils/localDb'
import { authVerifierHex, deriveLibraryKeys, deriveRootKey } from '../../shared/utils/libraryKeys'
import { createFakeCloudApi } from './fakeCloudApi'

const PASS = 'otter-pencil-river-mango-tulip'

function sessionStorageShim() {
  const m = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) })
  return m
}

describe('useCloudLibrary', () => {
  let fake: ReturnType<typeof createFakeCloudApi>
  let created: { id: string; verifier: string; invite: string } | null
  let session: Map<string, string>

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbForTests()
    __resetCloudForTests()
    session = sessionStorageShim()
    fake = createFakeCloudApi()
    created = null
    __setCloudApiFactory(() => ({
      ...fake.api,
      async createLibrary(id: string, verifier: string, invite: string) {
        if (invite !== 'good') throw new ApiError(404)
        created = { id, verifier, invite }
      },
    }))
  })

  it('create registers id + verifier, saves an empty manifest and opens', async () => {
    const lib = useCloudLibrary()
    const res = await lib.create(PASS, 'good')
    expect(res?.recoveryKey.startsWith('MCKEY-')).toBe(true)
    const keys = await deriveLibraryKeys(await deriveRootKey(PASS))
    expect(created).toEqual({ id: keys.libraryId, verifier: await authVerifierHex(keys.kAuth), invite: 'good' })
    expect(lib.status.value).toBe('open')
    expect(lib.games.value).toEqual([])
    expect(fake.calls.putManifest).toBe(1)
    expect(session.get(SESSION_KEY)).toBeTruthy()
  }, 30_000)

  it('create with a bad invite reports it and stays closed', async () => {
    const lib = useCloudLibrary()
    expect(await lib.create(PASS, 'bad')).toBeNull()
    expect(lib.notice.value?.key).toBe('cloud.badInvite')
    expect(lib.status.value).toBe('closed')
  }, 30_000)

  it('open with an unknown password says no library and writes nothing', async () => {
    __setCloudApiFactory(() => ({ ...fake.api, getManifest: async () => { throw new ApiError(404) } }))
    const lib = useCloudLibrary()
    expect(await lib.open('wrong-password-xyz-1234')).toBe(false)
    expect(lib.notice.value?.key).toBe('cloud.noLibrary')
    expect(lib.status.value).toBe('closed')
    expect(fake.calls.putManifest).toBe(0)
    expect(session.size).toBe(0)
  }, 30_000)

  it('open, close and restore from the session', async () => {
    const lib = useCloudLibrary()
    await lib.create(PASS, 'good')
    lib.close()
    expect(lib.status.value).toBe('closed')
    expect(session.size).toBe(0)
    expect(await lib.open(PASS)).toBe(true)
    __resetCloudForTests()
    const again = useCloudLibrary()
    await again.restore()
    expect(again.status.value).toBe('open')
  }, 30_000)

  it('saveManifest retries once after a 412 without losing changes', async () => {
    const lib = useCloudLibrary()
    await lib.create(PASS, 'good')
    fake.failManifestOnce()
    await lib.saveManifest((m) => { m.games.push({ id: 'g', title: 'T', kind: 'single', primaryName: 't.chd', files: [], sizeBytes: 1, createdAt: 1, lastPlayedAt: null, kGame: 'x' }) })
    expect(lib.games.value.map((g) => g.id)).toEqual(['g'])
  }, 30_000)
})
