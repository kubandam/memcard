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

import { addGame, getUploadStates, setCover, getSetting } from '../../app/utils/localDb'
import { downloadObject } from '../../app/utils/cloudDownload'
import { fromBase64Url } from '../../shared/utils/bytes'

const MiB = 1024 * 1024
async function localGame(files: [string, number][], title = 'Two Files') {
  const g = await addGame({ title, kind: files.length > 1 ? 'multi' : 'single', primaryName: files[0]![0], files: files.map(([n, size]) => new File([new Uint8Array(size).fill(n.length)], n)), totalBytes: files.reduce((a, [, s]) => a + s, 0) })
  return g
}

describe('useCloudLibrary — uploads', () => {
  let fake: ReturnType<typeof createFakeCloudApi>
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbForTests()
    __resetCloudForTests()
    sessionStorageShim()
  })

  async function openWith(f: ReturnType<typeof createFakeCloudApi>) {
    fake = f
    __setCloudApiFactory(() => f.api)
    const lib = useCloudLibrary()
    await lib.create(PASS, 'good')
    return lib
  }

  it('uploads every file (and the cover) of a local game and records it in the manifest', async () => {
    const lib = await openWith(createFakeCloudApi())
    const g = await localGame([['g.cue', 20], ['g.bin', 5 * MiB]])
    await setCover(g.id, new Blob([new Uint8Array(30)], { type: 'image/png' }))
    const fresh = (await import('../../app/utils/localDb')).getGame
    await lib.uploadGame((await fresh(g.id))!)
    expect(lib.games.value).toHaveLength(1)
    const entry = lib.games.value[0]!
    expect(entry.files.map((f) => f.name)).toEqual(['g.cue', 'g.bin'])
    expect(entry.coverObjectKey).toBeTruthy()
    expect(fromBase64Url(entry.kGame)).toHaveLength(32)
    expect(fake.objects.size).toBe(3)
    const bin = await downloadObject(fake.api, entry.files[1]!, fromBase64Url(entry.kGame))
    expect(bin.length).toBe(5 * MiB)
    expect(await getUploadStates(lib.libraryId.value!)).toEqual([])
    expect(lib.isInCloud((await fresh(g.id))!)).toBe(true)
  }, 60_000)

  it('quota on the second file deletes what was uploaded and leaves the manifest unchanged', async () => {
    const lib = await openWith(createFakeCloudApi({ quotaBytes: 6 * MiB }))
    const g = await localGame([['a.chd', 4 * MiB], ['b.chd', 4 * MiB]], 'Big')
    await lib.uploadGame(g)
    expect(lib.games.value).toEqual([])
    expect(fake.objects.size).toBe(0)
    expect(lib.notice.value?.key).toBe('cloud.quota')
  }, 60_000)

  it('resumes an interrupted upload from local storage after a reload', async () => {
    const f = createFakeCloudApi()
    const lib = await openWith(f)
    const g = await localGame([['big.chd', 40 * MiB]], 'Resume Me')
    let n = 0
    const realPart = f.api.uploadPart
    f.api.uploadPart = async (...a) => { if (++n === 2) throw new Error('network'); return realPart(...a) }
    await lib.uploadGame(g)
    expect(lib.notice.value?.key).toBe('cloud.uploadFailed')
    expect(lib.games.value).toEqual([])
    f.api.uploadPart = realPart
    f.calls.uploadPart.length = 0
    __resetCloudForTests()
    const again = useCloudLibrary()
    await again.restore()
    await again.resumeUploads()
    expect(f.calls.uploadPart).toEqual([2, 3])
    expect(again.games.value.map((x) => x.title)).toEqual(['Resume Me'])
    expect(await getSetting(`cloudPending.${again.libraryId.value}`)).toEqual([])
  }, 60_000)

  it('deleteGame removes objects and the manifest entry', async () => {
    const lib = await openWith(createFakeCloudApi())
    await lib.uploadGame(await localGame([['x.chd', 1000]], 'X'))
    await lib.deleteGame(lib.games.value[0]!.id)
    expect(lib.games.value).toEqual([])
    expect(fake.objects.size).toBe(0)
  }, 60_000)
})

import { listGames } from '../../app/utils/localDb'

describe('useCloudLibrary — download', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbForTests()
    __resetCloudForTests()
    sessionStorageShim()
  })

  it('downloadToLocal adds the decrypted game (files + cover) to My games', async () => {
    const f = createFakeCloudApi()
    __setCloudApiFactory(() => f.api)
    const lib = useCloudLibrary()
    await lib.create(PASS, 'good')
    const g = await localGame([['d.cue', 20], ['d.bin', 3 * MiB]], 'Down Load')
    await setCover(g.id, new Blob([new Uint8Array(30).fill(3)], { type: 'image/png' }))
    const { getGame: fresh, deleteGame: drop } = await import('../../app/utils/localDb')
    await lib.uploadGame((await fresh(g.id))!)
    await drop(g.id)
    expect(await listGames()).toEqual([])

    const added = await lib.downloadToLocal(lib.games.value[0]!.id)
    const all = await listGames()
    expect(all.map((x) => x.title)).toEqual(['Down Load'])
    expect(added.files.map((x) => [x.name, x.size])).toEqual([['d.cue', 20], ['d.bin', 3 * MiB]])
    expect(added.coverBlobKey).toBeTruthy()
    expect(added.primaryName).toBe('d.cue')
  }, 60_000)

  it('downloadGameFiles returns named Files with the original bytes', async () => {
    const f = createFakeCloudApi()
    __setCloudApiFactory(() => f.api)
    const lib = useCloudLibrary()
    await lib.create(PASS, 'good')
    await lib.uploadGame(await localGame([['solo.chd', 1234]], 'Solo'))
    const files = await lib.downloadGameFiles(lib.games.value[0]!)
    expect(files.map((x) => [x.name, x.size])).toEqual([['solo.chd', 1234]])
    expect(new Uint8Array(await files[0]!.arrayBuffer())[0]).toBe('solo.chd'.length)
  }, 60_000)
})
