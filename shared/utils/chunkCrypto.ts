import { randomBase32 } from './base32'
import { concatBytes } from './bytes'
import { hkdf } from './libraryKeys'

export const CHUNK_SIZE = 4 * 1024 * 1024
export const GCM_TAG = 16
export const IV_BYTES = 12

const enc = new TextEncoder()

export function chunkCount(plainSize: number): number {
  return Math.ceil(plainSize / CHUNK_SIZE)
}

export function encryptedSize(plainSize: number): number {
  return plainSize + chunkCount(plainSize) * GCM_TAG
}

export function plainSizeOfChunk(index: number, plainSize: number): number {
  return Math.max(0, Math.min(CHUNK_SIZE, plainSize - index * CHUNK_SIZE))
}

/** Per-object AES-GCM key: HKDF(K_game, "obj" || objectKey). Keeps counter nonces unique per key. */
export async function deriveObjectKey(kGame: Uint8Array, objectKey: string): Promise<CryptoKey> {
  const raw = await hkdf(kGame, `obj${objectKey}`, 32)
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function nonceFor(index: number): Uint8Array {
  const n = new Uint8Array(IV_BYTES)
  new DataView(n.buffer).setUint32(8, index, false)
  new DataView(n.buffer).setUint32(4, Math.floor(index / 2 ** 32), false)
  return n
}

export function aadFor(objectKey: string, index: number): Uint8Array {
  return enc.encode(`${objectKey}:${index}`)
}

export async function encryptChunk(key: CryptoKey, objectKey: string, index: number, plain: Uint8Array): Promise<Uint8Array> {
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceFor(index) as BufferSource, additionalData: aadFor(objectKey, index) as BufferSource }, key, plain as BufferSource)
  return new Uint8Array(out)
}

export async function decryptChunk(key: CryptoKey, objectKey: string, index: number, cipher: Uint8Array): Promise<Uint8Array> {
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonceFor(index) as BufferSource, additionalData: aadFor(objectKey, index) as BufferSource }, key, cipher as BufferSource)
  return new Uint8Array(out)
}

/** iv (12 random bytes) || AES-GCM(JSON). */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)))
  return concatBytes(iv, new Uint8Array(ct))
}

export async function decryptJson<T>(key: CryptoKey, bytes: Uint8Array): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) as BufferSource }, key, bytes.subarray(IV_BYTES) as BufferSource)
  return JSON.parse(new TextDecoder().decode(pt)) as T
}

export function newObjectKey(): string {
  return randomBase32(14)
}

export function newGameKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}
