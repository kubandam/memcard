/// <reference types="@cloudflare/workers-types" />

export interface LibraryRow {
  id: string
  authVerifier: string
  manifestEtag: string | null
  bytesUsed: number
}

export interface LibraryStore {
  createLibrary(id: string, authVerifier: string): Promise<'created' | 'exists'>
  getLibrary(id: string): Promise<LibraryRow | null>
  setManifestEtag(id: string, etag: string): Promise<void>
  totalBytes(): Promise<number>
  addObject(libraryId: string, key: string, size: number): Promise<void>
  removeObject(libraryId: string, key: string): Promise<number>
  listObjects(libraryId: string): Promise<{ key: string; size: number }[]>
  putUpload(id: string, libraryId: string, key: string, uploadId: string): Promise<void>
  getUpload(id: string): Promise<{ libraryId: string; key: string; uploadId: string } | null>
  deleteUpload(id: string): Promise<void>
}

export function createMemoryStore(): LibraryStore {
  const libs = new Map<string, LibraryRow>()
  const objects = new Map<string, Map<string, number>>()
  const uploads = new Map<string, { libraryId: string; key: string; uploadId: string }>()
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
    async setManifestEtag(id, etag) {
      const row = libs.get(id)
      if (row) row.manifestEtag = etag
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
      uploads.set(id, { libraryId, key, uploadId })
    },
    async getUpload(id) {
      return uploads.get(id) ?? null
    },
    async deleteUpload(id) {
      uploads.delete(id)
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
    async setManifestEtag(id, etag) {
      await db.prepare('UPDATE libraries SET manifest_etag = ?2, updated_at = ?3 WHERE id = ?1').bind(id, etag, now()).run()
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
      const r = await db.prepare('SELECT library_id, key, upload_id FROM uploads WHERE id = ?1').bind(id).first<{ library_id: string; key: string; upload_id: string }>()
      return r ? { libraryId: r.library_id, key: r.key, uploadId: r.upload_id } : null
    },
    async deleteUpload(id) {
      await db.prepare('DELETE FROM uploads WHERE id = ?1').bind(id).run()
    },
  }
}
