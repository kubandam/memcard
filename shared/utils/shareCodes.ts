import type { SharePayload } from '../types/share'
import { decodeBase32, encodeBase32 } from './base32'
import { concatBytes } from './bytes'
import { decryptJson, encryptJson } from './chunkCrypto'
import { hkdf } from './libraryKeys'

const SECRET_BYTES = 10
const CODE_CHARS = 16
const enc = new TextEncoder()

export function newShareSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
}

/** `MC-XXXX-XXXX-XXXX-XXXX` (16 Crockford base32 chars = 80 bits). */
export function formatShareCode(secret: Uint8Array): string {
  const body = encodeBase32(secret).toUpperCase()
  return `MC-${body.match(/.{4}/g)!.join('-')}`
}

/** Normalises user input; returns the 10-byte secret or null when it is not a code. */
export function parseShareCode(input: string): Uint8Array | null {
  let s = input.toUpperCase().replace(/[\s-]/g, '')
  if (s.length === CODE_CHARS + 2 && s.startsWith('MC')) s = s.slice(2)
  if (s.length !== CODE_CHARS) return null
  try {
    const bytes = decodeBase32(s)
    return bytes.length === SECRET_BYTES ? bytes : null
  } catch {
    return null
  }
}

export async function deriveShareKeys(secret: Uint8Array): Promise<{ shareId: string; kShare: CryptoKey }> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', concatBytes(enc.encode('memcard-share-id'), secret) as BufferSource))
  const shareId = encodeBase32(digest.subarray(0, 16))
  const raw = await hkdf(secret, 'share', 32)
  const kShare = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { shareId, kShare }
}

export function wrapPayload(kShare: CryptoKey, payload: SharePayload): Promise<Uint8Array> {
  return encryptJson(kShare, payload)
}

export async function unwrapPayload(kShare: CryptoKey, bytes: Uint8Array): Promise<SharePayload> {
  const p = await decryptJson<SharePayload>(kShare, bytes)
  if (p?.v !== 1) throw new Error('Unsupported share payload')
  if (p.kind === 'library' && typeof p.kLib === 'string') return p
  if (p.kind === 'game' && p.game && typeof p.game.kGame === 'string' && Array.isArray(p.game.files)) return p
  throw new Error('Malformed share payload')
}
