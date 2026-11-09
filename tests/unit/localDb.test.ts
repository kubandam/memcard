// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassifiedGame } from '../../shared/types/game'
import {
  StorageError,
  __resetDbForTests,
  addGame,
  deleteGame,
  estimateStorage,
  getBlob,
  getGame,
  getSetting,
  listGames,
  renameGame,
  setSetting,
  touchLastPlayed,
} from '../../app/utils/localDb'

const f = (name: string, size = 16) => new File([new Uint8Array(size)], name)

function classified(title: string, files: File[] = [f(`${title}.cue`, 8), f(`${title}.bin`, 32)]): ClassifiedGame {
  return {
    title,
    kind: files.length > 1 ? 'multi' : 'single',
    primaryName: files[0]!.name,
    files,
    totalBytes: files.reduce((n, x) => n + x.size, 0),
  }
}

// idb caches wrapped prototype methods on first use, so the spy must exist before any store is touched.
const originalPut = IDBObjectStore.prototype.put
const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put')
const passthrough = function (this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
  return originalPut.apply(this, args)
}

describe('localDb', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    __resetDbForTests()
    putSpy.mockImplementation(passthrough)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('addGame stores metadata and blobs, listGames returns it', async () => {
    const game = await addGame(classified('Alpha'))
    expect(game.id).toMatch(/[0-9a-f-]{36}/)
    expect(game.files).toHaveLength(2)
    expect(game.sizeBytes).toBe(40)
    expect(game.source).toBe('local')
    const blob = await getBlob(game.files[1]!.blobKey)
    expect(blob?.size).toBe(32)
    expect(await listGames()).toHaveLength(1)
    expect((await getGame(game.id))?.title).toBe('Alpha')
  })

  it('two games with the same title get distinct ids', async () => {
    const a = await addGame(classified('Same'))
    const b = await addGame(classified('Same'))
    expect(a.id).not.toBe(b.id)
    expect(await listGames()).toHaveLength(2)
  })

  it('renameGame rejects empty titles and trims others', async () => {
    const g = await addGame(classified('Old'))
    await expect(renameGame(g.id, '  ')).rejects.toBeInstanceOf(RangeError)
    await renameGame(g.id, '  New  ')
    expect((await getGame(g.id))?.title).toBe('New')
  })

  it('deleteGame removes the metadata and its blobs', async () => {
    const g = await addGame(classified('Gone'))
    await deleteGame(g.id)
    expect(await getGame(g.id)).toBeUndefined()
    expect(await getBlob(g.files[0]!.blobKey)).toBeUndefined()
  })

  it('touchLastPlayed sorts the game first', async () => {
    const a = await addGame(classified('A'))
    await addGame(classified('B'))
    await touchLastPlayed(a.id)
    const list = await listGames()
    expect(list[0]!.id).toBe(a.id)
    expect(list[0]!.lastPlayedAt).toBeTypeOf('number')
  })

  it('addGame rolls back blobs and throws StorageError(quota) when a write hits the quota', async () => {
    const quota = new DOMException('full', 'QuotaExceededError')
    let calls = 0
    putSpy.mockImplementation(function (this: IDBObjectStore, ...args: [unknown, IDBValidKey?]) {
      if (this.name === 'blobs' && ++calls % 2 === 0) throw quota
      return originalPut.apply(this, args)
    })
    await expect(addGame(classified('Big'))).rejects.toMatchObject({ code: 'quota' })
    await expect(addGame(classified('Big'))).rejects.toBeInstanceOf(StorageError)
    putSpy.mockImplementation(passthrough)
    expect(await listGames()).toHaveLength(0)
    const db = await (await import('../../app/utils/localDb')).openDb()
    expect(await db.count('blobs')).toBe(0)
  })

  it('settings round-trip', async () => {
    expect(await getSetting('bios')).toBeUndefined()
    await setSetting('bios', 'key-1')
    expect(await getSetting<string>('bios')).toBe('key-1')
  })

  it('estimateStorage returns null when navigator.storage is missing', async () => {
    const nav = globalThis.navigator
    vi.stubGlobal('navigator', {})
    expect(await estimateStorage()).toBeNull()
    vi.stubGlobal('navigator', nav)
  })
})
