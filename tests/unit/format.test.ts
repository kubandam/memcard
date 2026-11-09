import { describe, expect, it } from 'vitest'
import { formatBytes, formatRelative } from '../../app/utils/format'

describe('formatBytes', () => {
  it('formats with one decimal from KB up', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(1234567890)).toBe('1.2 GB')
    expect(formatBytes(40e9)).toBe('40 GB')
  })
})

describe('formatRelative', () => {
  const now = Date.UTC(2026, 10, 9, 12)
  it('handles never, just now, minutes, hours, days', () => {
    expect(formatRelative(null, now)).toBe('never')
    expect(formatRelative(now - 10_000, now)).toBe('just now')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(formatRelative(now - 60 * 60_000, now)).toBe('1 hour ago')
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2 days ago')
  })
})
