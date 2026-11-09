import { createError, getHeader, type H3Event } from 'h3'
import { fromBase64Url, toHex } from '~~/shared/utils/bytes'
import type { LibraryRow, LibraryStore } from './libraryStore'

export const LIBRARY_ID_RE = /^[0-9a-hjkmnp-tv-z]{26}$/
export const OBJECT_KEY_RE = /^[0-9a-hjkmnp-tv-z]{23}$/
export const SOFT_LIMIT = 8 * 1024 ** 3
export const DEFAULT_HARD_LIMIT = 9 * 1024 ** 3

/** Every "you may not" answer is the same 404, so library ids cannot be probed. */
export function notFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyBearer(event: H3Event, authVerifier: string): Promise<boolean> {
  const header = getHeader(event, 'authorization') ?? ''
  const m = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(header)
  if (!m) return false
  let kAuth: Uint8Array
  try {
    kAuth = fromBase64Url(m[1]!)
  } catch {
    return false
  }
  const digest = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', kAuth as BufferSource)))
  return equalHex(digest, authVerifier)
}

export async function requireOwner(event: H3Event, store: LibraryStore, libraryId: string): Promise<LibraryRow> {
  if (!LIBRARY_ID_RE.test(libraryId)) notFound()
  const row = await store.getLibrary(libraryId)
  if (!row || !(await verifyBearer(event, row.authVerifier))) notFound()
  return row
}

export function checkInvite(configured: string | undefined, invite: string | undefined): boolean {
  if (!configured || !invite) return false
  return configured.split(',').map((s) => s.trim()).filter(Boolean).includes(invite.trim())
}

export function requireObjectKey(key: string): string {
  if (!OBJECT_KEY_RE.test(key)) notFound()
  return key
}

export function hardLimit(env: { TOTAL_BYTES_LIMIT?: string }): number {
  const n = Number(env.TOTAL_BYTES_LIMIT)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HARD_LIMIT
}

export const manifestKey = (libraryId: string) => `lib/${libraryId}/manifest`
export const objectPath = (libraryId: string, key: string) => `lib/${libraryId}/obj/${key}`
