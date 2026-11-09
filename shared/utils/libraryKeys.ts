import { encodeBase32 } from './base32'
import { fromBase64Url, toBase64Url, toHex } from './bytes'

export const APP_SALT = 'memcard-v1'
export const PBKDF2_ITERATIONS = 600_000
export const RECOVERY_PREFIX = 'MCKEY-'

const enc = new TextEncoder()

export async function deriveRootKey(password: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(APP_SALT), iterations: PBKDF2_ITERATIONS }, base, 256)
  return new Uint8Array(bits)
}

export async function hkdf(ikm: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, bytes * 8)
  return new Uint8Array(bits)
}

export interface LibraryKeys {
  libraryId: string
  kAuth: Uint8Array
  kLib: CryptoKey
}

export async function deriveLibraryKeys(kRoot: Uint8Array): Promise<LibraryKeys> {
  const libraryId = encodeBase32(await hkdf(kRoot, 'id', 16))
  const kAuth = await hkdf(kRoot, 'auth', 32)
  const kLib = await crypto.subtle.importKey('raw', (await hkdf(kRoot, 'lib', 32)) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { libraryId, kAuth, kLib }
}

export async function authVerifierHex(kAuth: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', kAuth as BufferSource)))
}

/** Value of the `Authorization: Bearer …` header that proves ownership. */
export function toAuthHeader(kAuth: Uint8Array): string {
  return toBase64Url(kAuth)
}

export function formatRecoveryKey(kRoot: Uint8Array): string {
  return RECOVERY_PREFIX + toBase64Url(kRoot)
}

export function parseSecret(input: string): { kind: 'recovery'; kRoot: Uint8Array } | { kind: 'password'; password: string } {
  const trimmed = input.trim()
  if (trimmed.startsWith(RECOVERY_PREFIX)) {
    const kRoot = fromBase64Url(trimmed.slice(RECOVERY_PREFIX.length))
    if (kRoot.length === 32) return { kind: 'recovery', kRoot }
  }
  return { kind: 'password', password: input }
}
