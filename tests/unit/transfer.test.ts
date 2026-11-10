import { describe, expect, it } from 'vitest'
import { describeTransfer, formatEta } from '../../app/utils/transfer'

describe('describeTransfer', () => {
  it('shows size, speed and time left for a network download', () => {
    const d = describeTransfer({ done: 120e6, total: 324e6, network: 120e6, startedAt: 0, at: 15_000 })
    expect(d).toMatchObject({ cached: false, percent: 37, done: '120 MB', total: '324 MB', speed: '8 MB/s', eta: '~26 s' })
  })

  it('hides speed during the first second', () => {
    expect(describeTransfer({ done: 1e6, total: 324e6, network: 1e6, startedAt: 0, at: 300 }).speed).toBe('…')
  })

  it('recognises a game loaded from the cache', () => {
    expect(describeTransfer({ done: 50e6, total: 100e6, network: 0, startedAt: 0, at: 500 })).toMatchObject({ cached: true, percent: 50 })
  })

  it('formats minutes', () => {
    expect(formatEta(125)).toBe('~2 min 5 s')
    expect(formatEta(120)).toBe('~2 min')
    expect(formatEta(0.2)).toBe('~1 s')
  })
})
