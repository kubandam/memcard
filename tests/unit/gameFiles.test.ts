import { describe, expect, it } from 'vitest'
import {
  classifyFiles,
  generateM3u,
  isSupported,
  parseCue,
  parseM3u,
  titleFromFilename,
} from '../../app/utils/gameFiles'

const f = (name: string, content: string | number = 16) =>
  new File([typeof content === 'string' ? content : new Uint8Array(content)], name)

describe('classifyFiles', () => {
  it('accepts a single chd', async () => {
    const r = await classifyFiles([f('Magic Castle (Disc 1).chd')])
    expect(r).toMatchObject({
      ok: true,
      game: { kind: 'single', primaryName: 'Magic Castle (Disc 1).chd', title: 'Magic Castle', totalBytes: 16 },
    })
  })

  it('accepts cue + referenced bins as multi', async () => {
    const r = await classifyFiles([
      f('g.cue', 'FILE "g (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "g (Track 2).bin" BINARY'),
      f('g (Track 1).bin'),
      f('g (Track 2).bin'),
    ])
    expect(r).toMatchObject({ ok: true, game: { kind: 'multi', primaryName: 'g.cue', title: 'g' } })
    if (r.ok) expect(r.game.files.map((x) => x.name)).toEqual(['g.cue', 'g (Track 1).bin', 'g (Track 2).bin'])
  })

  it('rejects a cue referencing a missing bin', async () => {
    const r = await classifyFiles([f('g.cue', 'FILE "g.bin" BINARY')])
    expect(r).toMatchObject({ ok: false, error: { code: 'missing-bin', details: ['g.bin'] } })
  })

  it('rejects a lone bin', async () => {
    expect(await classifyFiles([f('g.bin')])).toMatchObject({ ok: false, error: { code: 'missing-cue', details: ['g.bin'] } })
  })

  it('flags an unreferenced extra bin as mixed', async () => {
    const r = await classifyFiles([f('g.cue', 'FILE "g.bin" BINARY'), f('g.bin'), f('other.bin')])
    expect(r).toMatchObject({ ok: false, error: { code: 'mixed', details: ['other.bin'] } })
  })

  it('accepts m3u with its discs', async () => {
    const r = await classifyFiles([f('Game.m3u', 'Game (Disc 1).chd\n# comment\nGame (Disc 2).chd\n'), f('Game (Disc 1).chd'), f('Game (Disc 2).chd')])
    expect(r).toMatchObject({ ok: true, game: { kind: 'multi', primaryName: 'Game.m3u', title: 'Game' } })
  })

  it('rejects m3u with a missing disc, naming it', async () => {
    const r = await classifyFiles([f('Game.m3u', 'Game (Disc 1).chd\nGame (Disc 2).chd'), f('Game (Disc 1).chd')])
    expect(r).toMatchObject({ ok: false, error: { code: 'missing-m3u-disc', details: ['Game (Disc 2).chd'] } })
  })

  it('generates an m3u for several discs without one', async () => {
    const r = await classifyFiles([f('Game (Disc 2).chd'), f('Game (Disc 1).chd')])
    expect(r).toMatchObject({ ok: true, game: { kind: 'multi', primaryName: 'Game.m3u', title: 'Game' } })
    if (r.ok) expect(r.game.generatedM3u).toBe('Game (Disc 1).chd\nGame (Disc 2).chd\n')
  })

  it('rejects unsupported extensions, listing them', async () => {
    expect(await classifyFiles([f('readme.txt'), f('g.chd')])).toMatchObject({ ok: false, error: { code: 'unsupported', details: ['readme.txt'] } })
  })

  it('rejects an empty selection', async () => {
    expect(await classifyFiles([])).toMatchObject({ ok: false, error: { code: 'empty' } })
  })

  it('treats zip and 7z as single', async () => {
    expect(await classifyFiles([f('g.zip')])).toMatchObject({ ok: true, game: { kind: 'single' } })
    expect(await classifyFiles([f('g.7z')])).toMatchObject({ ok: true, game: { kind: 'single' } })
  })

  it('rejects two unrelated single images', async () => {
    expect(await classifyFiles([f('a.chd'), f('b.pbp')])).toMatchObject({ ok: false, error: { code: 'mixed' } })
  })
})

describe('helpers', () => {
  it('titleFromFilename strips region, disc and tags', () => {
    expect(titleFromFilename('Foo Bar (USA) (Disc 2) [!].chd')).toBe('Foo Bar')
    expect(titleFromFilename('Hra č.1 (Disc 1).chd')).toBe('Hra č.1')
    expect(titleFromFilename('.chd')).toBe('.chd')
  })

  it('generateM3u preserves unicode and spaces', () => {
    expect(generateM3u(['Hra č.1 (Disc 1).chd'])).toBe('Hra č.1 (Disc 1).chd\n')
  })

  it('parseCue returns referenced file names in order', () => {
    expect(parseCue('FILE "a b.bin" BINARY\nTRACK 01\nFILE c.bin BINARY\n')).toEqual(['a b.bin', 'c.bin'])
  })

  it('parseM3u skips blanks and comments', () => {
    expect(parseM3u('\n# x\nA.chd\r\nB.chd\n')).toEqual(['A.chd', 'B.chd'])
  })

  it('isSupported is case-insensitive', () => {
    expect(isSupported('G.CHD')).toBe(true)
    expect(isSupported('g.txt')).toBe(false)
  })
})

describe('classifyFiles — multi-disc cue sets', () => {
  const f = (name: string, content: string | number = 16) =>
    new File([typeof content === 'string' ? content : new Uint8Array(content)], name)

  it('accepts m3u + several cues and keeps every bin', async () => {
    const r = await classifyFiles([
      f('Game.m3u', 'Game (Disc 1).cue\nGame (Disc 2).cue\n'),
      f('Game (Disc 1).cue', 'FILE "Game (Disc 1).bin" BINARY'),
      f('Game (Disc 1).bin'),
      f('Game (Disc 2).cue', 'FILE "Game (Disc 2).bin" BINARY'),
      f('Game (Disc 2).bin'),
    ])
    expect(r).toMatchObject({ ok: true, game: { kind: 'multi', primaryName: 'Game.m3u', title: 'Game' } })
    if (r.ok) expect(r.game.files.map((x) => x.name).sort()).toEqual(['Game (Disc 1).bin', 'Game (Disc 1).cue', 'Game (Disc 2).bin', 'Game (Disc 2).cue', 'Game.m3u'])
  })

  it('accepts m3u + one cue and keeps its bin', async () => {
    const r = await classifyFiles([f('G.m3u', 'G.cue\n'), f('G.cue', 'FILE "G.bin" BINARY'), f('G.bin')])
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.game.files.map((x) => x.name).sort()).toEqual(['G.bin', 'G.cue', 'G.m3u'])
  })

  it('generates an m3u for several cue sets without one', async () => {
    const r = await classifyFiles([
      f('Game (Disc 2).cue', 'FILE "Game (Disc 2).bin" BINARY'),
      f('Game (Disc 2).bin'),
      f('Game (Disc 1).cue', 'FILE "Game (Disc 1).bin" BINARY'),
      f('Game (Disc 1).bin'),
    ])
    expect(r).toMatchObject({ ok: true, game: { kind: 'multi', primaryName: 'Game.m3u', generatedM3u: 'Game (Disc 1).cue\nGame (Disc 2).cue\n' } })
  })

  it('reports a bin missing from one of several cues', async () => {
    const r = await classifyFiles([f('A.cue', 'FILE "A.bin" BINARY'), f('A.bin'), f('B.cue', 'FILE "B.bin" BINARY')])
    expect(r).toMatchObject({ ok: false, error: { code: 'missing-bin', details: ['B.bin'] } })
  })
})
