import type { LibraryUsage } from '~~/shared/types/library'
import { toAuthHeader } from '~~/shared/utils/libraryKeys'
import { fromBase64Url, toBase64Url } from '~~/shared/utils/bytes'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(`API error ${status}${code ? ` (${code})` : ''}`)
    this.name = 'ApiError'
  }
}

export interface CloudApi {
  createLibrary(id: string, authVerifier: string, invite: string): Promise<void>
  usage(): Promise<LibraryUsage>
  getManifest(): Promise<{ bytes: Uint8Array; etag: string } | null>
  putManifest(bytes: Uint8Array, ifMatch: string | null): Promise<string>
  createUpload(key: string): Promise<string>
  uploadPart(key: string, uploadId: string, part: number, body: Uint8Array): Promise<string>
  completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[], size: number): Promise<void>
  abortUpload(key: string, uploadId: string): Promise<void>
  getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>
  deleteObject(key: string): Promise<void>
  createShare(input: { shareId: string; gameId: string | null; allowedKeys: string[]; wrapped: Uint8Array }): Promise<void>
  listShares(): Promise<IssuedShareRow[]>
  revokeShare(shareId: string): Promise<void>
}

export interface IssuedShareRow {
  id: string
  gameId: string | null
  createdAt: number
  revokedAt: number | null
}

/** Read-only access to a library through a share code. */
export interface ShareReader {
  getManifest(): Promise<{ bytes: Uint8Array; etag: string } | null>
  getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>
}

export interface ShareLookup {
  libraryId: string
  gameId: string | null
  wrapped: Uint8Array
}

export async function lookupShare(shareId: string, baseUrl = ''): Promise<ShareLookup> {
  const res = await check(await fetch(`${baseUrl}/api/share/${shareId}`, { cache: 'no-store' }))
  const body = (await res.json()) as { libraryId: string; gameId: string | null; wrapped: string }
  return { libraryId: body.libraryId, gameId: body.gameId, wrapped: fromBase64Url(body.wrapped) }
}

export function createShareReader(opts: { shareId: string; libraryId: string; baseUrl?: string }): ShareReader {
  const lib = `${opts.baseUrl ?? ''}/api/lib/${opts.libraryId}`
  const auth = { authorization: `Share ${opts.shareId}` }
  return {
    async getManifest() {
      const res = await check(await fetch(`${lib}/manifest`, { headers: auth, cache: 'no-store' }))
      if (res.status === 204) return null
      return { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get('etag') ?? '' }
    },
    async getRange(key, start, endInclusive) {
      const res = await check(await fetch(`${lib}/objects/${key}`, { headers: { ...auth, range: `bytes=${start}-${endInclusive}` }, cache: 'no-store' }))
      return new Uint8Array(await res.arrayBuffer())
    },
  }
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res
  let code: string | undefined
  try {
    const body = (await res.json()) as { statusMessage?: string; data?: { code?: string } }
    code = body?.data?.code ?? (res.status === 413 ? 'quota' : undefined)
  } catch {
    code = res.status === 413 ? 'quota' : undefined
  }
  throw new ApiError(res.status, code)
}

export function createCloudApi(opts: { libraryId: string; kAuth: Uint8Array; baseUrl?: string }): CloudApi {
  const base = `${opts.baseUrl ?? ''}/api/lib`
  const lib = `${base}/${opts.libraryId}`
  const auth = { authorization: `Bearer ${toAuthHeader(opts.kAuth)}` }
  const obj = (key: string) => `${lib}/objects/${key}`
  const mpu = (key: string, uploadId: string) => `${obj(key)}/mpu/${encodeURIComponent(uploadId)}`
  const json = { 'content-type': 'application/json' }

  return {
    async createLibrary(id, authVerifier, invite) {
      await check(await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ id, authVerifier, invite }) }))
    },
    async usage() {
      return (await (await check(await fetch(lib, { headers: auth }))).json()) as LibraryUsage
    },
    async getManifest() {
      const res = await check(await fetch(`${lib}/manifest`, { headers: auth, cache: 'no-store' }))
      if (res.status === 204) return null
      return { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get('etag') ?? '' }
    },
    async putManifest(bytes, ifMatch) {
      const headers: Record<string, string> = { ...auth, 'content-type': 'application/octet-stream' }
      if (ifMatch) headers['if-match'] = ifMatch
      const res = await check(await fetch(`${lib}/manifest`, { method: 'PUT', headers, body: bytes as BodyInit }))
      return ((await res.json()) as { etag: string }).etag
    },
    async createUpload(key) {
      const res = await check(await fetch(`${obj(key)}/mpu`, { method: 'POST', headers: auth }))
      return ((await res.json()) as { uploadId: string }).uploadId
    },
    async uploadPart(key, uploadId, part, body) {
      const res = await check(await fetch(`${mpu(key, uploadId)}/${part}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: body as BodyInit }))
      return ((await res.json()) as { etag: string }).etag
    },
    async completeUpload(key, uploadId, parts, size) {
      await check(await fetch(`${mpu(key, uploadId)}/complete`, { method: 'POST', headers: { ...auth, ...json }, body: JSON.stringify({ parts, size }) }))
    },
    async abortUpload(key, uploadId) {
      await check(await fetch(mpu(key, uploadId), { method: 'DELETE', headers: auth }))
    },
    async getRange(key, start, endInclusive) {
      const res = await check(await fetch(obj(key), { headers: { ...auth, range: `bytes=${start}-${endInclusive}` }, cache: 'no-store' }))
      return new Uint8Array(await res.arrayBuffer())
    },
    async deleteObject(key) {
      await check(await fetch(obj(key), { method: 'DELETE', headers: auth }))
    },
    async createShare(input) {
      await check(await fetch(`${lib}/shares`, { method: 'POST', headers: { ...auth, ...json }, body: JSON.stringify({ shareId: input.shareId, gameId: input.gameId, allowedKeys: input.allowedKeys, wrapped: toBase64Url(input.wrapped) }) }))
    },
    async listShares() {
      return (await (await check(await fetch(`${lib}/shares`, { headers: auth, cache: 'no-store' }))).json()) as IssuedShareRow[]
    },
    async revokeShare(shareId) {
      await check(await fetch(`${lib}/shares/${shareId}`, { method: 'DELETE', headers: auth }))
    },
  }
}
