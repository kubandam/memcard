import { describe, expect, it } from 'vitest'
import words from '../../app/assets/wordlist/eff-short-1.json'
import { generatePassphrase, isStrongSecret } from '../../shared/utils/passphrase'
import { formatRecoveryKey } from '../../shared/utils/libraryKeys'

describe('passphrase', () => {
  it('wordlist has 1295 unique letter-only words (yo-yo removed: a dash would split it)', () => {
    expect(words).toHaveLength(1295)
    expect(new Set(words).size).toBe(1295)
    expect(words.every((w: string) => /^[a-z]+$/.test(w))).toBe(true)
  })
  it('generates 4 list words joined by dashes, differently each time', () => {
    const a = generatePassphrase(words)
    expect(a.split('-')).toHaveLength(4)
    for (const w of a.split('-')) expect(words).toContain(w)
    expect(generatePassphrase(words)).not.toBe(a)
  })
  it('strength rule', () => {
    expect(isStrongSecret('abc')).toBe(false)
    expect(isStrongSecret('short pass')).toBe(false)
    expect(isStrongSecret('otter-pencil-river-mango')).toBe(true)
    expect(isStrongSecret('otter pencil river mango')).toBe(true)
    expect(isStrongSecret('x'.repeat(16))).toBe(true)
    expect(isStrongSecret(formatRecoveryKey(new Uint8Array(32)))).toBe(true)
  })
})
