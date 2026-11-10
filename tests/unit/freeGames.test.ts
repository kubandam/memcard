import { describe, expect, it } from 'vitest'
import manifest from '../../content/free-games.json'
import { parseFreeGames, freeFileFor } from '../../shared/utils/freeGames'

const ok = {
  id: 'demo-game', title: 'Demo', author: 'Someone', year: 2024, genre: 'Arcade',
  license: 'MIT', sourceUrl: 'https://example.org/demo', sourceCode: 'https://example.org/demo/src',
  file: 'demo-game.chd', cover: 'demo-game.png', sizeBytes: 100, credits: ['Art: X, CC0'],
}

describe('free games manifest', () => {
  it('accepts a complete entry', () => {
    expect(parseFreeGames([ok])).toEqual([ok])
  })
  it('rejects entries without licence or source, with odd ids or file names, or duplicates', () => {
    expect(() => parseFreeGames([{ ...ok, license: '' }])).toThrow(/license/)
    expect(() => parseFreeGames([{ ...ok, sourceUrl: undefined }])).toThrow(/sourceUrl/)
    expect(() => parseFreeGames([{ ...ok, id: '../x' }])).toThrow(/id/)
    expect(() => parseFreeGames([{ ...ok, file: '../secret.chd' }])).toThrow(/file/)
    expect(() => parseFreeGames([ok, ok])).toThrow(/duplicate/)
  })
  it('the shipped manifest is valid, and every game has a licence, source and credits', () => {
    const games = parseFreeGames(manifest)
    expect(games.map((g) => g.id).sort()).toEqual(['voxide', 'yarmico2'])
    for (const g of games) {
      expect(g.license.length).toBeGreaterThan(2)
      expect(g.sourceUrl).toMatch(/^https:\/\//)
    }
  })
  it('only listed games resolve to a stored file', () => {
    const games = parseFreeGames([ok])
    expect(freeFileFor(games, 'demo-game', 'file')).toBe('free/demo-game.chd')
    expect(freeFileFor(games, 'demo-game', 'cover')).toBe('free/demo-game.png')
    expect(freeFileFor(games, 'nope', 'file')).toBeNull()
  })
})
