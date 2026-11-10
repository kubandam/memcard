import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ClassifiedGame, GameFileRef, LocalGame } from '~~/shared/types/game'
import type { UploadState } from './cloudUpload'

export const DB_NAME = 'memcard'
export const DB_VERSION = 3

interface MemcardDb extends DBSchema {
  games: {
    key: string
    value: LocalGame
    indexes: { lastPlayedAt: number }
  }
  blobs: {
    key: string
    value: Blob
  }
  settings: {
    key: string
    value: unknown
  }
  uploads: {
    key: string
    value: UploadState
    indexes: { libraryId: string }
  }
  /** Encrypted parts of cloud games kept on this PC (key `<cacheId>/<part>`). */
  cacheParts: {
    key: string
    value: Uint8Array
  }
  cacheIndex: {
    key: string
    value: CacheEntry
  }
}

/** One cached cloud object: `id` = `<libraryId>/<objectKey>`. */
export interface CacheEntry {
  id: string
  bytes: number
  lastUsedAt: number
}

export type StorageErrorCode = 'quota' | 'unavailable'

export class StorageError extends Error {
  constructor(
    public code: StorageErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

let dbPromise: Promise<IDBPDatabase<MemcardDb>> | null = null

export function openDb(): Promise<IDBPDatabase<MemcardDb>> {
  if (!dbPromise) {
    dbPromise = openDB<MemcardDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const games = db.createObjectStore('games', { keyPath: 'id' })
          games.createIndex('lastPlayedAt', 'lastPlayedAt')
          db.createObjectStore('blobs')
          db.createObjectStore('settings')
        }
        if (oldVersion < 2) {
          db.createObjectStore('uploads', { keyPath: 'id' }).createIndex('libraryId', 'libraryId')
        }
        if (oldVersion < 3) {
          db.createObjectStore('cacheParts')
          db.createObjectStore('cacheIndex', { keyPath: 'id' })
        }
      },
    }).catch((err) => {
      dbPromise = null
      throw toStorageError(err)
    })
  }
  return dbPromise
}

/** Test helper: forget the cached connection so a fresh IDBFactory is used. */
export function __resetDbForTests() {
  dbPromise = null
}

function toStorageError(err: unknown): StorageError {
  if (err instanceof StorageError) return err
  const name = (err as { name?: string } | null)?.name
  if (name === 'QuotaExceededError') return new StorageError('quota', 'Not enough storage space in this browser')
  return new StorageError('unavailable', (err as Error | null)?.message ?? 'Storage is unavailable')
}

function newKey(): string {
  return crypto.randomUUID()
}

export async function putBlob(blob: Blob): Promise<string> {
  const db = await openDb()
  const key = newKey()
  try {
    await db.put('blobs', blob, key)
  } catch (err) {
    throw toStorageError(err)
  }
  return key
}

export async function getBlob(blobKey: string): Promise<Blob | undefined> {
  const db = await openDb()
  return db.get('blobs', blobKey)
}

export async function deleteBlob(blobKey: string): Promise<void> {
  const db = await openDb()
  await db.delete('blobs', blobKey)
}

export async function addGame(game: ClassifiedGame): Promise<LocalGame> {
  const db = await openDb()
  const written: string[] = []
  try {
    const files: GameFileRef[] = []
    for (const file of game.files) {
      const blobKey = await putBlob(file)
      written.push(blobKey)
      files.push({ name: file.name, size: file.size, blobKey })
    }
    const record: LocalGame = {
      id: newKey(),
      title: game.title,
      source: 'local',
      kind: game.kind,
      primaryName: game.primaryName,
      files,
      generatedM3u: game.generatedM3u,
      sizeBytes: game.totalBytes,
      createdAt: Date.now(),
      lastPlayedAt: null,
    }
    await db.put('games', record)
    return record
  } catch (err) {
    await Promise.allSettled(written.map((key) => db.delete('blobs', key)))
    throw toStorageError(err)
  }
}

export async function listGames(): Promise<LocalGame[]> {
  const db = await openDb()
  const all = await db.getAll('games')
  return all.sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt)
}

export async function getGame(id: string): Promise<LocalGame | undefined> {
  const db = await openDb()
  return db.get('games', id)
}

export async function renameGame(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) throw new RangeError('Title must not be empty')
  const db = await openDb()
  const game = await db.get('games', id)
  if (!game) return
  await db.put('games', { ...game, title: trimmed })
}

export async function deleteGame(id: string): Promise<void> {
  const db = await openDb()
  const game = await db.get('games', id)
  if (!game) return
  const tx = db.transaction(['games', 'blobs'], 'readwrite')
  const keys = game.files.map((f) => f.blobKey)
  if (game.coverBlobKey) keys.push(game.coverBlobKey)
  await Promise.all([tx.objectStore('games').delete(id), ...keys.map((k) => tx.objectStore('blobs').delete(k)), tx.done])
}

export async function setCover(id: string, image: Blob): Promise<void> {
  const db = await openDb()
  const game = await db.get('games', id)
  if (!game) return
  const coverBlobKey = await putBlob(image)
  await db.put('games', { ...game, coverBlobKey })
  if (game.coverBlobKey) await db.delete('blobs', game.coverBlobKey)
}

export async function touchLastPlayed(id: string): Promise<void> {
  const db = await openDb()
  const game = await db.get('games', id)
  if (!game) return
  await db.put('games', { ...game, lastPlayedAt: Date.now() })
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return (await db.get('settings', key)) as T | undefined
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  try {
    await db.put('settings', value, key)
  } catch (err) {
    throw toStorageError(err)
  }
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await openDb()
  await db.delete('settings', key)
}

export async function clearAll(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['games', 'blobs', 'settings', 'uploads', 'cacheParts', 'cacheIndex'], 'readwrite')
  await Promise.all([
    tx.objectStore('games').clear(),
    tx.objectStore('blobs').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('uploads').clear(),
    tx.objectStore('cacheParts').clear(),
    tx.objectStore('cacheIndex').clear(),
    tx.done,
  ])
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  const storage = globalThis.navigator?.storage
  if (!storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

export async function requestPersist(): Promise<boolean> {
  const storage = globalThis.navigator?.storage
  if (!storage?.persist) return false
  try {
    return await storage.persist()
  } catch {
    return false
  }
}

/** Resumable cloud-upload state (one row per object being uploaded). */
export async function putUploadState(state: UploadState): Promise<void> {
  const db = await openDb()
  await db.put('uploads', structuredClone(state))
}

export async function getUploadStates(libraryId: string): Promise<UploadState[]> {
  const db = await openDb()
  return db.getAllFromIndex('uploads', 'libraryId', libraryId)
}

export async function deleteUploadState(id: string): Promise<void> {
  const db = await openDb()
  await db.delete('uploads', id)
}
