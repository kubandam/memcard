import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ClassifiedGame, GameFileRef, LocalGame } from '~~/shared/types/game'

export const DB_NAME = 'memcard'
export const DB_VERSION = 1

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
      upgrade(db) {
        const games = db.createObjectStore('games', { keyPath: 'id' })
        games.createIndex('lastPlayedAt', 'lastPlayedAt')
        db.createObjectStore('blobs')
        db.createObjectStore('settings')
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
  const tx = db.transaction(['games', 'blobs', 'settings'], 'readwrite')
  await Promise.all([tx.objectStore('games').clear(), tx.objectStore('blobs').clear(), tx.objectStore('settings').clear(), tx.done])
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
