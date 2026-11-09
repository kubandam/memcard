import { describe, expect, it } from 'vitest'
import { isSafeFileName, validateCloudGame } from '../../shared/utils/validateGame'

const ok = { id: '2c7a2d1c-0000-4000-8000-000000000000', title: 'T', kind: 'multi', primaryName: 'G.m3u', generatedM3u: 'G (Disc 1).chd\nG (Disc 2).chd\n', files: [{ name: 'G (Disc 1).chd', size: 1, objectKey: 'abcdefghjkmnpqrstvwxyz0', chunks: 1 }, { name: 'G (Disc 2).chd', size: 1, objectKey: 'abcdefghjkmnpqrstvwxyz1', chunks: 1 }], sizeBytes: 2, createdAt: 1, lastPlayedAt: null, kGame: 'AAAA' }

describe('isSafeFileName', () => {
  it('accepts plain supported names, rejects paths, dots, control chars and other extensions', () => {
    expect(isSafeFileName('Hra č.1 (Disc 1).chd')).toBe(true)
    for (const bad of ['../x.chd', 'a/b.chd', 'a\\b.chd', '..', '.', 'x\u0000.chd', 'evil.js', 'x.srm', '', 'a'.repeat(300) + '.chd']) expect(isSafeFileName(bad)).toBe(false)
  })
})

describe('validateCloudGame', () => {
  it('accepts a well-formed game', () => {
    expect(validateCloudGame(ok)).toBe(true)
  })
  it('rejects unsafe names, a primary that is not one of the files, and m3u lines outside the files', () => {
    expect(validateCloudGame({ ...ok, files: [{ ...ok.files[0], name: '../data/saves/x.srm' }, ok.files[1]] })).toBe(false)
    expect(validateCloudGame({ ...ok, generatedM3u: undefined, primaryName: 'other.cue' })).toBe(false)
    expect(validateCloudGame({ ...ok, generatedM3u: 'G (Disc 1).chd\n../../bios.bin\n' })).toBe(false)
    expect(validateCloudGame({ ...ok, primaryName: '../G.m3u' })).toBe(false)
    expect(validateCloudGame({ ...ok, files: [] })).toBe(false)
    expect(validateCloudGame({ ...ok, files: [ok.files[0], ok.files[0]] })).toBe(false)
    expect(validateCloudGame({ ...ok, kind: 'weird' })).toBe(false)
    expect(validateCloudGame(null)).toBe(false)
  })
  it('rejects odd object keys, a chunk count that does not match the size, and non-uuid ids', () => {
    expect(validateCloudGame({ ...ok, files: [{ ...ok.files[0], objectKey: '../manifest' }, ok.files[1]] })).toBe(false)
    expect(validateCloudGame({ ...ok, coverObjectKey: '../x' })).toBe(false)
    expect(validateCloudGame({ ...ok, files: [{ ...ok.files[0], size: 5 * 1024 * 1024, chunks: 1 }, ok.files[1]] })).toBe(false)
    expect(validateCloudGame({ ...ok, id: '../../evil' })).toBe(false)
    expect(validateCloudGame({ ...ok, sizeBytes: Number.NaN })).toBe(false)
  })

  it('a single game must be one file that is the primary', () => {
    expect(validateCloudGame({ ...ok, kind: 'single', primaryName: 'G (Disc 1).chd', generatedM3u: undefined, files: [ok.files[0]] })).toBe(true)
    expect(validateCloudGame({ ...ok, kind: 'single', primaryName: 'G (Disc 2).chd', generatedM3u: undefined, files: [ok.files[0]] })).toBe(false)
  })
})
