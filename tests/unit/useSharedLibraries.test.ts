// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCloudForTests, __setCloudApiFactory, useCloudLibrary } from '../../app/composables/useCloudLibrary'
import { __resetSharedForTests, __setShareTransport, ShareRevokedError, useSharedLibraries } from '../../app/composables/useSharedLibraries'
import { __resetDbForTests, addGame, listGames } from '../../app/utils/localDb'
import { deriveShareKeys, parseShareCode, unwrapPayload } from '../../shared/utils/shareCodes'
import { createFakeCloudApi } from './fakeCloudApi'

const PASS = 'otter-pencil-river-mango-tulip'

function sessionStorageShim() {
  const m = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) })
}

async function ownerWithGame(title = 'Shared Game', cover = false) {
  const f = createFakeCloudApi()
  __setCloudApiFactory(() => f.api)
  __setShareTransport({ lookup: f.shareTransport.lookup, reader: f.shareTransport.reader })
  const owner = useCloudLibrary()
  await owner.create(PASS, 'good')
  const g = await addGame({ title, kind: 'multi', primaryName: 'g.cue', files: [new File(['FILE "g.bin" BINARY'], 'g.cue'), new File([new Uint8Array(3000).fill(5)], 'g.bin')], totalBytes: 3019 })
  if (cover) await (await import('../../app/utils/localDb')).setCover(g.id, new Blob([new Uint8Array(10)], { type: 'image/png' }))
  await owner.uploadGame((await (await import('../../app/utils/localDb')).getGame(g.id))!)
  return { f, owner, cloudGame: owner.games.value[0]! }
}

describe('owner sharing', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbForTests(); __resetCloudForTests(); __resetSharedForTests(); sessionStorageShim()
  })

  it('shareGame posts the game keys and a payload the code unwraps to the same game', async () => {
    const { f, owner, cloudGame } = await ownerWithGame('Cover Game', true)
    const code = await owner.shareGame(cloudGame.id)
    expect(code).toMatch(/^MC-/)
    const { shareId, kShare } = await deriveShareKeys(parseShareCode(code)!)
    const row = f.shares.get(shareId)!
    expect(row.gameId).toBe(cloudGame.id)
    expect(row.allowedKeys.sort()).toEqual([...cloudGame.files.map((x) => x.objectKey), cloudGame.coverObjectKey!].sort())
    expect(await unwrapPayload(kShare, row.wrapped)).toEqual({ v: 1, kind: 'game', game: cloudGame })
  }, 60_000)

  it('shareLibrary wraps the library key; issued list is labelled; revoke and delete-cascade work', async () => {
    const { f, owner, cloudGame } = await ownerWithGame()
    const libCode = await owner.shareLibrary()
    const gameCode = await owner.shareGame(cloudGame.id)
    const libPayload = await unwrapPayload((await deriveShareKeys(parseShareCode(libCode)!)).kShare, f.shares.get((await deriveShareKeys(parseShareCode(libCode)!)).shareId)!.wrapped)
    expect(libPayload.kind).toBe('library')
    await owner.loadIssuedShares()
    expect(owner.issuedShares.value.map((x) => [x.kind, x.label])).toEqual([['game', 'Shared Game'], ['library', 'Whole library']])
    await owner.revokeShare(owner.issuedShares.value[1]!.id)
    expect(owner.issuedShares.value.map((x) => x.kind)).toEqual(['game'])
    await owner.deleteGame(cloudGame.id)
    expect(f.shares.get((await deriveShareKeys(parseShareCode(gameCode)!)).shareId)!.revokedAt).not.toBeNull()
  }, 60_000)
})

describe('recipient', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbForTests(); __resetCloudForTests(); __resetSharedForTests(); sessionStorageShim()
  })

  it('rejects malformed codes without any network call', async () => {
    const lookup = vi.fn()
    __setShareTransport({ lookup, reader: vi.fn() })
    expect(await useSharedLibraries().redeem('MC-1234')).toEqual({ error: 'format' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('game code: preview then download into My games', async () => {
    const { owner, cloudGame } = await ownerWithGame()
    const code = await owner.shareGame(cloudGame.id)
    owner.close()
    const shared = useSharedLibraries()
    const res = await shared.redeem(code.toLowerCase().replace(/-/g, ' '))
    expect(res).toMatchObject({ kind: 'game', game: { title: 'Shared Game' } })
    if (!('kind' in res) || res.kind !== 'game') throw new Error('expected game')
    const added = await shared.downloadToLocal(res)
    expect(added?.files.map((x) => [x.name, x.size])).toEqual([['g.cue', 19], ['g.bin', 3000]])
    expect(shared.libraries.value).toEqual([])
  }, 60_000)

  it('library code: saved, manifest decrypted, survives a reload; owner state untouched', async () => {
    const { owner } = await ownerWithGame()
    const code = await owner.shareLibrary()
    const ownerGames = owner.games.value.length
    const shared = useSharedLibraries()
    expect(await shared.redeem(code)).toMatchObject({ kind: 'library' })
    expect(shared.libraries.value[0]!.games.map((g) => g.title)).toEqual(['Shared Game'])
    expect(owner.status.value).toBe('open')
    expect(owner.games.value).toHaveLength(ownerGames)
    __resetSharedForTests()
    const again = useSharedLibraries()
    await again.restore()
    expect(again.libraries.value.map((l) => [l.status, l.games.length])).toEqual([['ok', 1]])
  }, 60_000)

  it('revoked: redeem says invalid; an open shared library fails downloads with ShareRevokedError; restore marks it revoked', async () => {
    const { owner } = await ownerWithGame()
    const code = await owner.shareLibrary()
    const shared = useSharedLibraries()
    await shared.redeem(code)
    const lib = shared.libraries.value[0]!
    await owner.loadIssuedShares()
    await owner.revokeShare(owner.issuedShares.value[0]!.id)
    await expect(shared.downloadGameFiles(lib.shareId, lib.games[0]!)).rejects.toBeInstanceOf(ShareRevokedError)
    expect(await shared.redeem(code)).toEqual({ error: 'invalid' })
    __resetSharedForTests()
    const again = useSharedLibraries()
    await again.restore()
    expect(again.libraries.value[0]!.status).toBe('revoked')
    await again.remove(again.libraries.value[0]!.shareId)
    expect(again.libraries.value).toEqual([])
    expect(await listGames()).toHaveLength(1) // owner's local copy only
  }, 60_000)
})
