// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LocalGame } from '../../shared/types/game'
import { buildGamePayload } from '../../app/utils/gamePayload'

function game(overrides: Partial<LocalGame>): LocalGame {
  return { id: 'g1', title: 'Hra č.1', source: 'local', kind: 'single', primaryName: 'Hra č.1.chd', files: [], sizeBytes: 0, createdAt: 0, lastPlayedAt: null, ...overrides }
}
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)
const text = async (f: File) => new TextDecoder().decode(await f.arrayBuffer())

describe('buildGamePayload', () => {
  it('single image: the File itself, no extra files', async () => {
    const blobs = new Map([['k1', new Blob([bytes(8, 7)])]])
    const { file, extraFiles } = await buildGamePayload(game({ files: [{ name: 'Hra č.1.chd', size: 8, blobKey: 'k1' }] }), async (k) => blobs.get(k))
    expect(file.name).toBe('Hra č.1.chd')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes(8, 7))
    expect(extraFiles).toEqual([])
  })

  it('generated m3u: playlist File as primary, each disc as an extra file at /<name>', async () => {
    const blobs = new Map([['a', new Blob([bytes(4, 1)])], ['b', new Blob([bytes(4, 2)])]])
    const progress: number[] = []
    const { file, extraFiles } = await buildGamePayload(
      game({
        kind: 'multi',
        primaryName: 'Hra č.1.m3u',
        generatedM3u: 'Hra č.1 (Disc 1).chd\nHra č.1 (Disc 2).chd\n',
        files: [{ name: 'Hra č.1 (Disc 1).chd', size: 4, blobKey: 'a' }, { name: 'Hra č.1 (Disc 2).chd', size: 4, blobKey: 'b' }],
      }),
      async (k) => blobs.get(k),
      (p) => progress.push(p),
    )
    expect(file.name).toBe('Hra č.1.m3u')
    expect(await text(file)).toBe('Hra č.1 (Disc 1).chd\nHra č.1 (Disc 2).chd\n')
    expect(extraFiles.map((e) => e.path)).toEqual(['/Hra č.1 (Disc 1).chd', '/Hra č.1 (Disc 2).chd'])
    expect(extraFiles[1]!.data).toEqual(bytes(4, 2))
    expect(progress.at(-1)).toBe(1)
  })

  it('cue + bin: the stored cue is primary, bin is extra', async () => {
    const blobs = new Map([['c', new Blob(['FILE "g.bin" BINARY'])], ['d', new Blob([bytes(2, 9)])]])
    const { file, extraFiles } = await buildGamePayload(
      game({ kind: 'multi', primaryName: 'g.cue', title: 'g', files: [{ name: 'g.cue', size: 19, blobKey: 'c' }, { name: 'g.bin', size: 2, blobKey: 'd' }] }),
      async (k) => blobs.get(k),
    )
    expect(file.name).toBe('g.cue')
    expect(await text(file)).toBe('FILE "g.bin" BINARY')
    expect(extraFiles.map((e) => e.path)).toEqual(['/g.bin'])
  })

  it('throws naming the missing stored file', async () => {
    await expect(buildGamePayload(game({ files: [{ name: 'x.chd', size: 1, blobKey: 'nope' }] }), async () => undefined)).rejects.toThrow(/x\.chd/)
  })
})
