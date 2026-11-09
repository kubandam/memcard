import { parseSecret } from './libraryKeys'

/** Uniformly random words (rejection sampling, no modulo bias), joined by "-". */
export function generatePassphrase(words: string[], count = 4): string {
  const out: string[] = []
  const limit = Math.floor(0x1_0000_0000 / words.length) * words.length
  const buf = new Uint32Array(1)
  while (out.length < count) {
    crypto.getRandomValues(buf)
    if (buf[0]! < limit) out.push(words[buf[0]! % words.length]!)
  }
  return out.join('-')
}

/** A recovery key, ≥ 16 characters, or ≥ 4 words of ≥ 3 letters. */
export function isStrongSecret(input: string): boolean {
  if (parseSecret(input).kind === 'recovery') return true
  const trimmed = input.trim()
  if (trimmed.length >= 16) return true
  const words = trimmed.split(/[\s-]+/).filter((w) => w.length >= 3)
  return words.length >= 4
}
