import type { ObjectCache } from './cloudDownload'
import { openDb, type CacheEntry } from './localDb'

/** Default room for cached cloud games on one PC. */
export const GAME_CACHE_LIMIT = 3 * 1000 ** 3

const partKey = (id: string, part: number) => `${id}/${String(part).padStart(6, '0')}`
const partRange = (id: string) => IDBKeyRange.bound(`${id}/`, `${id}/￿`)

/**
 * Cache of encrypted cloud-game parts in this browser, shared by the owner's library and shared
 * libraries (same library id + object key = same bytes). Every failure is swallowed: without the
 * cache the game simply downloads again.
 */
export function createGameCache(libraryId: string, opts: { limitBytes?: number; now?: () => number } = {}): ObjectCache {
  const limit = opts.limitBytes ?? GAME_CACHE_LIMIT
  const now = opts.now ?? Date.now
  const idOf = (objectKey: string) => `${libraryId}/${objectKey}`
  /** After a write failure (quota), stop trying for this object. */
  const broken = new Set<string>()

  return {
    async getPart(objectKey, part) {
      try {
        const db = await openDb()
        return await db.get('cacheParts', partKey(idOf(objectKey), part))
      } catch {
        return undefined
      }
    },

    async hasPart(objectKey, part) {
      try {
        const db = await openDb()
        return (await db.getKey('cacheParts', partKey(idOf(objectKey), part))) !== undefined
      } catch {
        return false
      }
    },

    async putPart(objectKey, part, cipher) {
      const id = idOf(objectKey)
      if (broken.has(id)) return
      try {
        const db = await openDb()
        const tx = db.transaction(['cacheParts', 'cacheIndex'], 'readwrite')
        const index = tx.objectStore('cacheIndex')
        const key = partKey(id, part)
        const had = await tx.objectStore('cacheParts').getKey(key)
        await tx.objectStore('cacheParts').put(cipher, key)
        const entry = (await index.get(id)) ?? { id, bytes: 0, lastUsedAt: now() }
        await index.put({ ...entry, bytes: entry.bytes + (had === undefined ? cipher.length : 0), lastUsedAt: now() })
        await tx.done
      } catch {
        broken.add(id)
        await dropEntry(id)
      }
    },

    async dropObject(objectKey) {
      await dropEntry(idOf(objectKey))
    },

    async finish(objectKey) {
      const id = idOf(objectKey)
      try {
        const db = await openDb()
        const entry = await db.get('cacheIndex', id)
        if (entry) await db.put('cacheIndex', { ...entry, lastUsedAt: now() })
        await evict(limit, id)
      } catch {
        // best effort
      }
    },
  }
}

async function dropEntry(id: string): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(['cacheParts', 'cacheIndex'], 'readwrite')
    await Promise.all([tx.objectStore('cacheParts').delete(partRange(id)), tx.objectStore('cacheIndex').delete(id), tx.done])
  } catch {
    // best effort
  }
}

/** Deletes the least recently used objects until the cache fits `limit` (never `keep`). */
async function evict(limit: number, keep?: string): Promise<void> {
  const db = await openDb()
  const entries = (await db.getAll('cacheIndex')).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  let total = entries.reduce((n, e) => n + e.bytes, 0)
  for (const e of entries) {
    if (total <= limit) break
    if (e.id === keep) continue
    await dropEntry(e.id)
    total -= e.bytes
  }
}

/** Encrypted bytes of one object stored on this PC (compare with its encrypted size for "complete"). */
export async function cachedObjectBytes(libraryId: string, objectKey: string): Promise<number> {
  try {
    const db = await openDb()
    return (await db.get('cacheIndex', `${libraryId}/${objectKey}`))?.bytes ?? 0
  } catch {
    return 0
  }
}

/** Bytes used by cached cloud games on this PC. */
export async function gameCacheUsage(): Promise<number> {
  try {
    const db = await openDb()
    return (await db.getAll('cacheIndex')).reduce((n: number, e: CacheEntry) => n + e.bytes, 0)
  } catch {
    return 0
  }
}

export async function clearGameCache(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['cacheParts', 'cacheIndex'], 'readwrite')
  await Promise.all([tx.objectStore('cacheParts').clear(), tx.objectStore('cacheIndex').clear(), tx.done])
}
