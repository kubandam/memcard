/** Minimal in-memory R2Bucket double covering what libraryService uses. */
export function createFakeR2() {
  const objects = new Map<string, Uint8Array>()
  const mpus = new Map<string, { key: string; parts: Map<number, Uint8Array> }>()
  let n = 0
  const bucket = {
    async put(key: string, body: Uint8Array) {
      objects.set(key, new Uint8Array(body))
      return { etag: `r2-${++n}`, size: body.length }
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const o = objects.get(key)
      if (!o) return null
      const slice = opts?.range ? o.slice(opts.range.offset, opts.range.offset + opts.range.length) : o
      return { size: o.length, etag: 'x', body: slice, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) }
    },
    async head(key: string) {
      const o = objects.get(key)
      return o ? { size: o.length } : null
    },
    async delete(key: string) {
      objects.delete(key)
    },
    async createMultipartUpload(key: string) {
      const uploadId = `mpu-${++n}`
      mpus.set(uploadId, { key, parts: new Map() })
      return { uploadId, key }
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return {
        async uploadPart(part: number, body: Uint8Array) {
          const m = mpus.get(uploadId)
          if (!m || m.key !== key) throw new Error('NoSuchUpload')
          m.parts.set(part, new Uint8Array(body))
          return { partNumber: part, etag: `p${part}` }
        },
        async complete(parts: { partNumber: number; etag: string }[]) {
          const m = mpus.get(uploadId)
          if (!m) throw new Error('NoSuchUpload')
          const chunks = parts.map((p) => m.parts.get(p.partNumber)!)
          const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0))
          let o = 0
          for (const c of chunks) (out.set(c, o), (o += c.length))
          objects.set(key, out)
          mpus.delete(uploadId)
          return { size: out.length }
        },
        async abort() {
          if (!mpus.delete(uploadId)) throw new Error('NoSuchUpload')
        },
      }
    },
  }
  return { bucket, objects, mpus }
}
