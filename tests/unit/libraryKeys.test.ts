// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { authVerifierHex, deriveLibraryKeys, deriveRootKey, formatRecoveryKey, parseSecret, toAuthHeader, type LibraryKeys } from '../../shared/utils/libraryKeys'

describe('library keys', () => {
  let rootA: Uint8Array
  let keysA: LibraryKeys
  beforeAll(async () => {
    rootA = await deriveRootKey('memcard test vector')
    keysA = await deriveLibraryKeys(rootA)
  }, 30_000)

  it('derives a deterministic 32-byte root key', async () => {
    expect(rootA).toHaveLength(32)
  })

  it('pins the derivation with a test vector', () => {
    expect(keysA.libraryId).toBe('b7tgpgrx48d5bg2204dgbz13mw')
  })

  it('libraryId is 26 Crockford chars and differs per password', async () => {
    expect(keysA.libraryId).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/)
    const other = await deriveLibraryKeys(await deriveRootKey('another password entirely'))
    expect(other.libraryId).not.toBe(keysA.libraryId)
  }, 30_000)

  it('auth verifier is sha256 hex of K_auth, not the bearer itself', async () => {
    const v = await authVerifierHex(keysA.kAuth)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    expect(toAuthHeader(keysA.kAuth)).not.toContain(v)
  })

  it('same root key always yields the same library keys', async () => {
    const again = await deriveLibraryKeys(rootA)
    expect(again.libraryId).toBe(keysA.libraryId)
    expect(again.kAuth).toEqual(keysA.kAuth)
  })

  it('recovery key round-trips and is recognised', () => {
    const r = formatRecoveryKey(rootA)
    expect(r.startsWith('MCKEY-')).toBe(true)
    const parsed = parseSecret(`  ${r}  `)
    expect(parsed.kind).toBe('recovery')
    if (parsed.kind === 'recovery') expect(parsed.kRoot).toEqual(rootA)
    expect(parseSecret('hunter2')).toEqual({ kind: 'password', password: 'hunter2' })
  })
})
