/** Crockford base32: lowercase out, case-insensitive and forgiving in (o→0, i/l→1, dashes ignored). */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export function encodeBase32(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31]
  return out
}

export function decodeBase32(text: string): Uint8Array {
  const clean = text.toLowerCase().replace(/-/g, '').replace(/o/g, '0').replace(/[il]/g, '1')
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch)
    if (v === -1) throw new Error(`Invalid base32 character: ${ch}`)
    buffer = ((buffer << 5) | v) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function randomBase32(bytes: number): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(bytes)))
}
