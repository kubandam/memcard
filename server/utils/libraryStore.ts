/// <reference types="@cloudflare/workers-types" />

export interface LibraryRow {
  id: string
  authVerifier: string
  manifestEtag: string | null
  bytesUsed: number
}

export interface ShareRow {
  id: string
  libraryId: string
  gameId: string | null
  allowedKeys: string[]
  wrapped: Uint8Array
  createdAt: number
  revokedAt: number | null
}

export type ShareListRow = Omit<ShareRow, 'wrapped'>

export interface LibraryStore {
  createLibrary(id: string, authVerifier: string): Promise<'created' | 'exists'>
  getLibrary(id: string): Promise<LibraryRow | null>
  /** Atomically moves the manifest pointer from `expected` (null = none yet) to `next`; false if it moved meanwhile. */
  swapManifest(id: string, expected: string | null, next: string): Promise<boolean>
  totalBytes(): Promise<number>
  addObject(libraryId: string, key: string, size: number): Promise<void>
  removeObject(libraryId: string, key: string): Promise<number>
  listObjects(libraryId: string): Promise<{ key: string; size: number }[]>
  putUpload(id: string, libraryId: string, key: string, uploadId: string): Promise<void>
  getUpload(id: string): Promise<{ libraryId: string; key: string; uploadId: string; createdAt: number } | null>
  deleteUpload(id: string): Promise<void>
  /** Reserves the bytes of one received part; re-sending a part replaces its reservation. */
  setPartBytes(id: string, part: number, bytes: number): Promise<void>
  partBytes(id: string, part: number): Promise<number>
  /** Bytes held by unfinished uploads created at or after `since` (optionally one library). */
  pendingBytes(since: number, libraryId?: string): Promise<number>
  openUploads(libraryId: string, since: number): Promise<number>
  /** Removes uploads created before `before` (R2 has expired them) and returns them. */
  deleteStaleUploads(before: number): Promise<{ id: string; libraryId: string; key: string }[]>
  createShare(row: Omit<ShareRow, 'createdAt' | 'revokedAt'>): Promise<'created' | 'exists'>
  getShare(id: string): Promise<ShareRow | null>
  /** Newest first, without the wrapped key material. */
  listShares(libraryId: string): Promise<ShareListRow[]>
  /** False if the share is not that library's or is already revoked. */
  revokeShare(libraryId: string, id: string): Promise<boolean>
  countActiveShares(libraryId: string): Promise<number>
}

export function createMemoryStore(now: () => number = Date.now): LibraryStore {
  const libs = new Map<string, LibraryRow>()
  const objects = new Map<string, Map<string, number>>()
  const uploads = new Map<string, { libraryId: string; key: string; uploadId: string; createdAt: number; parts: Map<number, number> }>()
  const shares = new Map<string, ShareRow>()
  return {
    async createLibrary(id, authVerifier) {
      if (libs.has(id)) return 'exists'
      libs.set(id, { id, authVerifier, manifestEtag: null, bytesUsed: 0 })
      objects.set(id, new Map())
      return 'created'
    },
    async getLibrary(id) {
      const row = libs.get(id)
      return row ? { ...row } : null
    },
    async swapManifest(id, expected, next) {
      const row = libs.get(id)
      if (!row || row.manifestEtag !== expected) return false
      row.manifestEtag = next
      return true
    },
    async totalBytes() {
      let n = 0
      for (const row of libs.values()) n += row.bytesUsed
      return n
    },
    async addObject(libraryId, key, size) {
      const map = objects.get(libraryId)
      const row = libs.get(libraryId)
      if (!map || !row) return
      row.bytesUsed += size - (map.get(key) ?? 0)
      map.set(key, size)
    },
    async removeObject(libraryId, key) {
      const map = objects.get(libraryId)
      const row = libs.get(libraryId)
      const size = map?.get(key) ?? 0
      if (map && row && size) {
        map.delete(key)
        row.bytesUsed -= size
      }
      return size
    },
    async listObjects(libraryId) {
      return [...(objects.get(libraryId) ?? new Map()).entries()].map(([key, size]) => ({ key, size }))
    },
    async putUpload(id, libraryId, key, uploadId) {
      uploads.set(id, { libraryId, key, uploadId, createdAt: now(), parts: new Map() })
    },
    async getUpload(id) {
      const u = uploads.get(id)
      return u ? { libraryId: u.libraryId, key: u.key, uploadId: u.uploadId, createdAt: u.createdAt } : null
    },
    async deleteUpload(id) {
      uploads.delete(id)
    },
    async setPartBytes(id, part, bytes) {
      uploads.get(id)?.parts.set(part, bytes)
    },
    async partBytes(id, part) {
      return uploads.get(id)?.parts.get(part) ?? 0
    },
    async pendingBytes(since, libraryId) {
      let n = 0
      for (const u of uploads.values()) {
        if (u.createdAt < since || (libraryId && u.libraryId !== libraryId)) continue
        for (const b of u.parts.values()) n += b
      }
      return n
    },
    async openUploads(libraryId, since) {
      let n = 0
      for (const u of uploads.values()) if (u.libraryId === libraryId && u.createdAt >= since) n++
      return n
    },
    async deleteStaleUploads(before) {
      const out: { id: string; libraryId: string; key: string }[] = []
      for (const [id, u] of uploads) if (u.createdAt < before) (out.push({ id, libraryId: u.libraryId, key: u.key }), uploads.delete(id))
      return out
    },
    async createShare(row) {
      if (shares.has(row.id)) return 'exists'
      shares.set(row.id, { ...row, allowedKeys: [...row.allowedKeys], wrapped: new Uint8Array(row.wrapped), createdAt: now(), revokedAt: null })
      return 'created'
    },
    async getShare(id) {
      const r = shares.get(id)
      return r ? { ...r, allowedKeys: [...r.allowedKeys], wrapped: new Uint8Array(r.wrapped) } : null
    },
    async listShares(libraryId) {
      return [...shares.values()]
        .filter((r) => r.libraryId === libraryId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(({ wrapped: _w, ...rest }) => ({ ...rest, allowedKeys: [...rest.allowedKeys] }))
    },
    async revokeShare(libraryId, id) {
      const r = shares.get(id)
      if (!r || r.libraryId !== libraryId || r.revokedAt !== null) return false
      r.revokedAt = now()
      return true
    },
    async countActiveShares(libraryId) {
      let n = 0
      for (const r of shares.values()) if (r.libraryId === libraryId && r.revokedAt === null) n++
      return n
    },
  }
}

export function createD1Store(db: D1Database): LibraryStore {
  const now = () => Date.now()
  return {
    async createLibrary(id, authVerifier) {
      const res = await db
        .prepare('INSERT OR IGNORE INTO libraries (id, auth_verifier, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)')
        .bind(id, authVerifier, now())
        .run()
      return res.meta.changes > 0 ? 'created' : 'exists'
    },
    async getLibrary(id) {
      const r = await db
        .prepare('SELECT id, auth_verifier, manifest_etag, bytes_used FROM libraries WHERE id = ?1')
        .bind(id)
        .first<{ id: string; auth_verifier: string; manifest_etag: string | null; bytes_used: number }>()
      return r ? { id: r.id, authVerifier: r.auth_verifier, manifestEtag: r.manifest_etag, bytesUsed: r.bytes_used } : null
    },
    async swapManifest(id, expected, next) {
      const res = await db
        .prepare('UPDATE libraries SET manifest_etag = ?3, updated_at = ?4 WHERE id = ?1 AND manifest_etag IS ?2')
        .bind(id, expected, next, now())
        .run()
      return res.meta.changes === 1
    },
    async totalBytes() {
      const r = await db.prepare('SELECT COALESCE(SUM(bytes_used), 0) AS n FROM libraries').first<{ n: number }>()
      return r?.n ?? 0
    },
    async addObject(libraryId, key, size) {
      const prev = await db.prepare('SELECT size FROM objects WHERE library_id = ?1 AND key = ?2').bind(libraryId, key).first<{ size: number }>()
      await db.batch([
        db.prepare('INSERT OR REPLACE INTO objects (library_id, key, size, created_at) VALUES (?1, ?2, ?3, ?4)').bind(libraryId, key, size, now()),
        db.prepare('UPDATE libraries SET bytes_used = bytes_used + ?2, updated_at = ?3 WHERE id = ?1').bind(libraryId, size - (prev?.size ?? 0), now()),
      ])
    },
    async removeObject(libraryId, key) {
      const prev = await db.prepare('SELECT size FROM objects WHERE library_id = ?1 AND key = ?2').bind(libraryId, key).first<{ size: number }>()
      if (!prev) return 0
      await db.batch([
        db.prepare('DELETE FROM objects WHERE library_id = ?1 AND key = ?2').bind(libraryId, key),
        db.prepare('UPDATE libraries SET bytes_used = bytes_used - ?2, updated_at = ?3 WHERE id = ?1').bind(libraryId, prev.size, now()),
      ])
      return prev.size
    },
    async listObjects(libraryId) {
      const r = await db.prepare('SELECT key, size FROM objects WHERE library_id = ?1').bind(libraryId).all<{ key: string; size: number }>()
      return r.results
    },
    async putUpload(id, libraryId, key, uploadId) {
      await db.prepare('INSERT OR REPLACE INTO uploads (id, library_id, key, upload_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, libraryId, key, uploadId, now()).run()
    },
    async getUpload(id) {
      const r = await db.prepare('SELECT library_id, key, upload_id, created_at FROM uploads WHERE id = ?1').bind(id).first<{ library_id: string; key: string; upload_id: string; created_at: number }>()
      return r ? { libraryId: r.library_id, key: r.key, uploadId: r.upload_id, createdAt: r.created_at } : null
    },
    async deleteUpload(id) {
      await db.batch([db.prepare('DELETE FROM upload_parts WHERE upload_id = ?1').bind(id), db.prepare('DELETE FROM uploads WHERE id = ?1').bind(id)])
    },
    async setPartBytes(id, part, bytes) {
      await db.prepare('INSERT OR REPLACE INTO upload_parts (upload_id, part, bytes) VALUES (?1, ?2, ?3)').bind(id, part, bytes).run()
    },
    async partBytes(id, part) {
      const r = await db.prepare('SELECT bytes FROM upload_parts WHERE upload_id = ?1 AND part = ?2').bind(id, part).first<{ bytes: number }>()
      return r?.bytes ?? 0
    },
    async pendingBytes(since, libraryId) {
      const sql = 'SELECT COALESCE(SUM(p.bytes), 0) AS n FROM upload_parts p JOIN uploads u ON u.id = p.upload_id WHERE u.created_at >= ?1' + (libraryId ? ' AND u.library_id = ?2' : '')
      const stmt = libraryId ? db.prepare(sql).bind(since, libraryId) : db.prepare(sql).bind(since)
      return (await stmt.first<{ n: number }>())?.n ?? 0
    },
    async openUploads(libraryId, since) {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE library_id = ?1 AND created_at >= ?2').bind(libraryId, since).first<{ n: number }>()
      return r?.n ?? 0
    },
    async deleteStaleUploads(before) {
      const r = await db.prepare('SELECT id, library_id, key FROM uploads WHERE created_at < ?1 LIMIT 50').bind(before).all<{ id: string; library_id: string; key: string }>()
      for (const row of r.results) {
        await db.batch([db.prepare('DELETE FROM upload_parts WHERE upload_id = ?1').bind(row.id), db.prepare('DELETE FROM uploads WHERE id = ?1').bind(row.id)])
      }
      return r.results.map((x) => ({ id: x.id, libraryId: x.library_id, key: x.key }))
    },
    async createShare(row) {
      const res = await db
        .prepare('INSERT OR IGNORE INTO shares (id, library_id, game_id, allowed_keys, wrapped, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(row.id, row.libraryId, row.gameId, JSON.stringify(row.allowedKeys), row.wrapped, now())
        .run()
      return res.meta.changes > 0 ? 'created' : 'exists'
    },
    async getShare(id) {
      const r = await db
        .prepare('SELECT id, library_id, game_id, allowed_keys, wrapped, created_at, revoked_at FROM shares WHERE id = ?1')
        .bind(id)
        .first<{ id: string; library_id: string; game_id: string | null; allowed_keys: string; wrapped: ArrayBuffer | number[]; created_at: number; revoked_at: number | null }>()
      if (!r) return null
      return { id: r.id, libraryId: r.library_id, gameId: r.game_id, allowedKeys: JSON.parse(r.allowed_keys) as string[], wrapped: new Uint8Array(r.wrapped as ArrayBuffer), createdAt: r.created_at, revokedAt: r.revoked_at }
    },
    async listShares(libraryId) {
      const r = await db
        .prepare('SELECT id, library_id, game_id, allowed_keys, created_at, revoked_at FROM shares WHERE library_id = ?1 ORDER BY created_at DESC')
        .bind(libraryId)
        .all<{ id: string; library_id: string; game_id: string | null; allowed_keys: string; created_at: number; revoked_at: number | null }>()
      return r.results.map((x) => ({ id: x.id, libraryId: x.library_id, gameId: x.game_id, allowedKeys: JSON.parse(x.allowed_keys) as string[], createdAt: x.created_at, revokedAt: x.revoked_at }))
    },
    async revokeShare(libraryId, id) {
      const res = await db.prepare('UPDATE shares SET revoked_at = ?3 WHERE id = ?1 AND library_id = ?2 AND revoked_at IS NULL').bind(id, libraryId, now()).run()
      return res.meta.changes === 1
    },
    async countActiveShares(libraryId) {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE library_id = ?1 AND revoked_at IS NULL').bind(libraryId).first<{ n: number }>()
      return r?.n ?? 0
    },
  }
}
