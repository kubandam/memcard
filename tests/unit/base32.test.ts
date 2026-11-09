// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decodeBase32, encodeBase32, randomBase32 } from '../../shared/utils/base32'

describe('base32 (Crockford)', () => {
  it('round-trips random bytes', () => {
    for (const n of [1, 5, 14, 16, 31]) {
      const bytes = crypto.getRandomValues(new Uint8Array(n))
      expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes)
    }
  })
  it('encodes lowercase in the Crockford alphabet', () => {
    expect(encodeBase32(new Uint8Array([0xff, 0xff]))).toMatch(/^[0-9a-hjkmnp-tv-z]+$/)
    expect(encodeBase32(new Uint8Array(16))).toHaveLength(26)
  })
  it('decodes leniently: case, O→0, I/L→1, dashes', () => {
    const s = encodeBase32(new Uint8Array([1, 2, 3, 4, 5]))
    expect(decodeBase32(s.toUpperCase())).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(decodeBase32('o')).toEqual(decodeBase32('0'))
    expect(decodeBase32('ii')).toEqual(decodeBase32('11'))
    expect(decodeBase32('L1')).toEqual(decodeBase32('11'))
    expect(decodeBase32('00-00')).toEqual(decodeBase32('0000'))
  })
  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase32('u')).toThrow()
    expect(() => decodeBase32('ab!')).toThrow()
  })
  it('randomBase32 gives the expected length', () => {
    expect(randomBase32(14)).toHaveLength(23)
  })
})
