// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { LocalGame } from '../../shared/types/game'
import { buildGameFile } from '../../app/utils/packGame'

function game(overrides: Partial<LocalGame>): LocalGame {
  return {
    id: 'g1',
    title: 'Hra č.1',
    source: 'local',
    kind: 'single',
    primaryName: 'Hra č.1.chd',
    files: [],
    sizeBytes: 0,
    createdAt: 0,
    lastPlayedAt: null,
    ...overrides,
  }
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

describe('buildGameFile', () => {
  it('returns the single image as a File with its original name and bytes', async () => {
    const blobs = new Map([['k1', new Blob([bytes(8, 7)])]])
    const file = await buildGameFile(game({ files: [{ name: 'Hra č.1.chd', size: 8, blobKey: 'k1' }] }), async (k) => blobs.get(k))
    expect(file.name).toBe('Hra č.1.chd')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes(8, 7))
  })

  it('packs multi-file games into a store-only zip with the generated m3u', async () => {
    const blobs = new Map([
      ['a', new Blob([bytes(4, 1)])],
      ['b', new Blob([bytes(4, 2)])],
    ])
    const progress: number[] = []
    const file = await buildGameFile(
      game({
        kind: 'multi',
        primaryName: 'Hra č.1.m3u',
        generatedM3u: 'Hra č.1 (Disc 1).chd\nHra č.1 (Disc 2).chd\n',
        files: [
          { name: 'Hra č.1 (Disc 1).chd', size: 4, blobKey: 'a' },
          { name: 'Hra č.1 (Disc 2).chd', size: 4, blobKey: 'b' },
        ],
      }),
      async (k) => blobs.get(k),
      (p) => progress.push(p),
    )
    expect(file.name).toBe('Hra č.1.zip')
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(['Hra č.1 (Disc 1).chd', 'Hra č.1 (Disc 2).chd', 'Hra č.1.m3u'])
    expect(strFromU8(entries['Hra č.1.m3u']!)).toBe('Hra č.1 (Disc 1).chd\nHra č.1 (Disc 2).chd\n')
    expect(entries['Hra č.1 (Disc 2).chd']).toEqual(bytes(4, 2))
    expect(progress.at(-1)).toBe(1)
    expect(progress.length).toBeGreaterThanOrEqual(2)
  })

  it('packs cue + bin without adding an m3u', async () => {
    const blobs = new Map([
      ['c', new Blob(['FILE "g.bin" BINARY'])],
      ['d', new Blob([bytes(2, 9)])],
    ])
    const file = await buildGameFile(
      game({ kind: 'multi', primaryName: 'g.cue', title: 'g', files: [{ name: 'g.cue', size: 19, blobKey: 'c' }, { name: 'g.bin', size: 2, blobKey: 'd' }] }),
      async (k) => blobs.get(k),
    )
    expect(Object.keys(unzipSync(new Uint8Array(await file.arrayBuffer()))).sort()).toEqual(['g.bin', 'g.cue'])
  })

  it('throws when a blob is missing', async () => {
    await expect(buildGameFile(game({ files: [{ name: 'x.chd', size: 1, blobKey: 'nope' }] }), async () => undefined)).rejects.toThrow(/x\.chd/)
  })
})
