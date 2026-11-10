import { encodeBase32 } from './base32'
import { concatBytes } from './bytes'
import { hkdf } from './libraryKeys'

const IV = 12
const HEADER = 8 + 16

export interface CloudSave {
  card: Uint8Array
  updatedAt: number
  hash: string
}

export interface SyncMeta {
  updatedAt: number
  hash: string
}

/** FNV-1a 64-bit as 16 hex chars — synchronous so it can run inside EmulatorJS's sync FS hook. */
export function fingerprint(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const b of bytes) {
    h ^= BigInt(b)
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

export async function deriveSaveKeys(kGame: Uint8Array): Promise<{ saveKey: string; key: CryptoKey }> {
  const saveKey = encodeBase32((await hkdf(kGame, 'save:memcard', 14)))
  const raw = await hkdf(kGame, 'save-key', 32)
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { saveKey, key }
}

export async function sealSave(key: CryptoKey, saveKey: string, card: Uint8Array, updatedAt: number): Promise<Uint8Array> {
  const header = new Uint8Array(HEADER)
  new DataView(header.buffer).setBigUint64(0, BigInt(updatedAt), false)
  header.set(new TextEncoder().encode(fingerprint(card)), 8)
  const iv = crypto.getRandomValues(new Uint8Array(IV))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(saveKey) }, key, concatBytes(header, card) as BufferSource)
  return concatBytes(iv, new Uint8Array(ct))
}

export async function openSave(key: CryptoKey, saveKey: string, bytes: Uint8Array): Promise<CloudSave> {
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV) as BufferSource, additionalData: new TextEncoder().encode(saveKey) }, key, bytes.subarray(IV) as BufferSource),
  )
  const updatedAt = Number(new DataView(pt.buffer, pt.byteOffset).getBigUint64(0, false))
  const hash = new TextDecoder().decode(pt.subarray(8, HEADER))
  const card = pt.slice(HEADER)
  if (fingerprint(card) !== hash) throw new Error('Save fingerprint mismatch')
  return { card, updatedAt, hash }
}

export type StartDecision =
  | { action: 'none' }
  | { action: 'push' }
  | { action: 'pull'; inject: Uint8Array }
  | { action: 'conflict'; inject: Uint8Array; keepLocal: Uint8Array }

/**
 * What to do with the memory card when a cloud game starts.
 * `meta` = the version this browser last uploaded or pulled. Cloud wins conflicts; the local card is kept for download.
 */
export function decideOnStart(input: { local: Uint8Array | null; meta: SyncMeta | null; cloud: CloudSave | null }): StartDecision & { inject?: Uint8Array; keepLocal?: Uint8Array } {
  const { local, meta, cloud } = input
  const localHash = local ? fingerprint(local) : null
  if (!cloud) return local ? { action: 'push' } : { action: 'none' }
  if (localHash === cloud.hash) return { action: 'none' }
  if (!local || (meta && localHash === meta.hash)) return { action: 'pull', inject: cloud.card }
  if (meta && cloud.hash === meta.hash) return { action: 'push' }
  return { action: 'conflict', inject: cloud.card, keepLocal: local }
}

/** Keys for the one synced save-state slot of a game and its screenshot. */
export async function deriveStateKeys(kGame: Uint8Array): Promise<{ stateKey: string; shotKey: string; key: CryptoKey }> {
  const stateKey = encodeBase32(await hkdf(kGame, 'state:latest', 14))
  const shotKey = encodeBase32(await hkdf(kGame, 'state:shot', 14))
  const raw = await hkdf(kGame, 'state-key', 32)
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { stateKey, shotKey, key }
}
