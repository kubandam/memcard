// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveShareKeys, formatShareCode, newShareSecret, parseShareCode, unwrapPayload, wrapPayload } from '../../shared/utils/shareCodes'
import { deriveLibraryKeys } from '../../shared/utils/libraryKeys'
import { decryptJson, encryptJson } from '../../shared/utils/chunkCrypto'
import { fromBase64Url, toBase64Url } from '../../shared/utils/bytes'

const SECRET = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

describe('share code format', () => {
  it('formats 10 bytes as MC-XXXX-XXXX-XXXX-XXXX and parses it back', () => {
    const s = newShareSecret()
    expect(s).toHaveLength(10)
    const code = formatShareCode(s)
    expect(code).toMatch(/^MC-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(parseShareCode(code)).toEqual(s)
  })
  it('is forgiving: lowercase, no dashes, no prefix, spaces, O/0 and I/L/1', () => {
    const code = formatShareCode(SECRET)
    const body = code.slice(3)
    expect(parseShareCode(body.toLowerCase())).toEqual(SECRET)
    expect(parseShareCode(body.replace(/-/g, ''))).toEqual(SECRET)
    expect(parseShareCode(` mc ${body.replace(/-/g, ' ')} `)).toEqual(SECRET)
    expect(parseShareCode(body.replace(/0/g, 'O').replace(/1/g, 'I'))).toEqual(SECRET)
  })
  it('rejects wrong lengths and foreign characters', () => {
    const body = formatShareCode(SECRET).slice(3).replace(/-/g, '')
    expect(parseShareCode(body.slice(1))).toBeNull()
    expect(parseShareCode(body + '0')).toBeNull()
    expect(parseShareCode(body.slice(1) + 'U')).toBeNull()
    expect(parseShareCode('')).toBeNull()
  })
})

describe('share keys and payloads', () => {
  it('derives a deterministic 26-char shareId (pinned) that differs per secret', async () => {
    const a = await deriveShareKeys(SECRET)
    expect(a.shareId).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/)
    expect(a.shareId).toBe('7747g0f9tsnfbxqcjfrypkext4')
    expect((await deriveShareKeys(SECRET)).shareId).toBe(a.shareId)
    expect((await deriveShareKeys(newShareSecret())).shareId).not.toBe(a.shareId)
  })

  it('wraps and unwraps library and game payloads; another code cannot unwrap', async () => {
    const { kShare } = await deriveShareKeys(SECRET)
    const lib = { v: 1 as const, kind: 'library' as const, kLib: toBase64Url(new Uint8Array(32).fill(7)) }
    expect(await unwrapPayload(kShare, await wrapPayload(kShare, lib))).toEqual(lib)
    const game = { v: 1 as const, kind: 'game' as const, game: { id: '2c7a2d1c-0000-4000-8000-000000000000', title: 'T', kind: 'single' as const, primaryName: 't.chd', files: [{ name: 't.chd', size: 1, objectKey: 'abcdefghjkmnpqrstvwxyz0', chunks: 1 }], sizeBytes: 1, createdAt: 1, lastPlayedAt: null, kGame: 'x' } }
    const w = await wrapPayload(kShare, game)
    expect(await unwrapPayload(kShare, w)).toEqual(game)
    const other = await deriveShareKeys(newShareSecret())
    await expect(unwrapPayload(other.kShare, w)).rejects.toThrow()
  })

  it('rejects a game payload with unsafe file names', async () => {
    const { kShare } = await deriveShareKeys(SECRET)
    const evil = { v: 1, kind: 'game', game: { id: 'g', title: 'T', kind: 'single', primaryName: '../data/saves/x.srm', files: [{ name: '../data/saves/x.srm', size: 1, objectKey: 'abcdefghjkmnpqrstvwxyz0', chunks: 1 }], sizeBytes: 1, createdAt: 1, lastPlayedAt: null, kGame: 'x' } }
    await expect(unwrapPayload(kShare, await encryptJson(kShare, evil))).rejects.toThrow()
  })

  it('rejects a payload of the wrong shape', async () => {
    const { kShare } = await deriveShareKeys(SECRET)
    await expect(unwrapPayload(kShare, await encryptJson(kShare, { v: 1, kind: 'nope' }))).rejects.toThrow()
  })

  it('kLibRaw imported as a key decrypts what kLib encrypted', async () => {
    const keys = await deriveLibraryKeys(new Uint8Array(32).fill(3))
    const blob = await encryptJson(keys.kLib, { hello: 1 })
    const k = await crypto.subtle.importKey('raw', fromBase64Url(toBase64Url(keys.kLibRaw)), 'AES-GCM', false, ['decrypt'])
    expect(await decryptJson(k, blob)).toEqual({ hello: 1 })
  })
})
