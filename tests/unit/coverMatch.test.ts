import { describe, expect, it } from 'vitest'
import { normalizeGameName, pickCover, parseThumbnailIndex, regionOf } from '../../shared/utils/coverMatch'

describe('regionOf', () => {
  it('reads a known region group from a file name', () => {
    expect(regionOf('Crash Bandicoot (Europe) (No EDC).7z')).toBe('europe')
    expect(regionOf('Spider-Man.7z')).toBeNull()
  })
})

const NAMES = [
  'Looney Tunes - Sheep Raider (USA) (En,Fr,Es,Pt).png',
  'Looney Tunes Racing (Europe) (En,Fr,De,Es,It).png',
  'Looney Tunes Racing (USA) (En,Fr,Es).png',
  'Crash Bandicoot (USA).png',
  'Crash Bandicoot 2 - Cortex Strikes Back (USA).png',
  'Crash Bandicoot 3 - Warped (USA).png',
]

describe('normalizeGameName', () => {
  it('lowercases, strips region/language groups, extension and punctuation', () => {
    expect(normalizeGameName('Looney Tunes - Sheep Raider (USA) (En,Fr,Es,Pt).png')).toBe('looney tunes sheep raider')
    expect(normalizeGameName('Crash Bandicoot 2 - Cortex Strikes Back')).toBe('crash bandicoot 2 cortex strikes back')
    expect(normalizeGameName("Tony Hawk's Pro Skater 2 [SLUS-01066].chd")).toBe('tony hawks pro skater 2')
  })
})

describe('pickCover', () => {
  it('prefers an exact normalized match', () => {
    expect(pickCover('Crash Bandicoot', NAMES)).toBe('Crash Bandicoot (USA).png')
    expect(pickCover('Looney Tunes - Sheep Raider', NAMES)).toBe('Looney Tunes - Sheep Raider (USA) (En,Fr,Es,Pt).png')
  })
  it('prefers USA then Europe when several regions match', () => {
    expect(pickCover('Looney Tunes Racing', NAMES)).toBe('Looney Tunes Racing (USA) (En,Fr,Es).png')
  })
  it('honours the region in the source file name', () => {
    expect(pickCover('Looney Tunes Racing (Europe).7z', NAMES)).toBe('Looney Tunes Racing (Europe) (En,Fr,De,Es,It).png')
    expect(pickCover('Crash Bandicoot (Europe) (No EDC).7z', [...NAMES, 'Crash Bandicoot (Europe).png'])).toBe('Crash Bandicoot (Europe).png')
    // Region hint that has no cover → fall back to the usual order.
    expect(pickCover('Looney Tunes Racing (Japan).chd', NAMES)).toBe('Looney Tunes Racing (USA) (En,Fr,Es).png')
  })

  it('falls back to a unique prefix match, otherwise null', () => {
    expect(pickCover('Crash Bandicoot 3', NAMES)).toBe('Crash Bandicoot 3 - Warped (USA).png')
    expect(pickCover('Crash', NAMES)).toBeNull()
    expect(pickCover('Spyro', NAMES)).toBeNull()
  })
})

describe('parseThumbnailIndex', () => {
  it('extracts and decodes png names from an Apache-style listing', () => {
    const html = '<a href="Crash%20Bandicoot%20(USA).png">x</a> <a href="../">up</a> <a href="Spyro%20the%20Dragon%20(USA).png">y</a>'
    expect(parseThumbnailIndex(html)).toEqual(['Crash Bandicoot (USA).png', 'Spyro the Dragon (USA).png'])
  })
})
