// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE, chunkCount, decryptChunk, decryptJson, deriveObjectKey, encryptChunk, encryptJson, encryptedSize,
  newGameKey, newObjectKey, plainSizeOfChunk,
} from '../../shared/utils/chunkCrypto'

const MiB = 1024 * 1024

describe('chunk sizes', () => {
  it('splits 9 MiB into 4+4+1 and adds a tag per chunk', () => {
    expect(chunkCount(9 * MiB)).toBe(3)
    expect(plainSizeOfChunk(2, 9 * MiB)).toBe(1 * MiB)
    expect(plainSizeOfChunk(0, 9 * MiB)).toBe(CHUNK_SIZE)
    expect(encryptedSize(9 * MiB)).toBe(9 * MiB + 3 * 16)
    expect(chunkCount(0)).toBe(0)
  })
})

describe('chunk encryption', () => {
  const kGame = newGameKey()
  const objectKey = newObjectKey()

  it('round-trips and rejects tampering, reordering and the wrong object key', async () => {
    const key = await deriveObjectKey(kGame, objectKey)
    const plain = crypto.getRandomValues(new Uint8Array(1000))
    const c1 = await encryptChunk(key, objectKey, 1, plain)
    expect(c1).toHaveLength(1016)
    expect(await decryptChunk(key, objectKey, 1, c1)).toEqual(plain)

    const flipped = c1.slice(); flipped[10]! ^= 1
    await expect(decryptChunk(key, objectKey, 1, flipped)).rejects.toThrow()
    await expect(decryptChunk(key, objectKey, 0, c1)).rejects.toThrow()

    const otherKey = newObjectKey()
    const wrong = await deriveObjectKey(kGame, otherKey)
    await expect(decryptChunk(wrong, objectKey, 1, c1)).rejects.toThrow()
  })

  it('two objects of one game never share a keystream (per-object subkeys)', async () => {
    const a = newObjectKey(); const b = newObjectKey()
    const zeros = new Uint8Array(64)
    const ca = await encryptChunk(await deriveObjectKey(kGame, a), a, 0, zeros)
    const cb = await encryptChunk(await deriveObjectKey(kGame, b), b, 0, zeros)
    expect(ca.subarray(0, 64)).not.toEqual(cb.subarray(0, 64))
  })

  it('json helpers round-trip with a fresh IV each time', async () => {
    const key = await crypto.subtle.importKey('raw', newGameKey(), 'AES-GCM', false, ['encrypt', 'decrypt'])
    const v = { games: [{ title: 'Hra č.1' }] }
    const x = await encryptJson(key, v); const y = await encryptJson(key, v)
    expect(x.subarray(0, 12)).not.toEqual(y.subarray(0, 12))
    expect(await decryptJson(key, x)).toEqual(v)
  })

  it('object keys are 23-char base32 and game keys 32 bytes', () => {
    expect(newObjectKey()).toMatch(/^[0-9a-hjkmnp-tv-z]{23}$/)
    expect(newGameKey()).toHaveLength(32)
  })
})
