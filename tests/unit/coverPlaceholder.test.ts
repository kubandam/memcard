import { describe, expect, it } from 'vitest'
import { placeholderStyle } from '../../app/utils/coverPlaceholder'

describe('placeholderStyle', () => {
  it('is deterministic and differs between titles', () => {
    const a = placeholderStyle('Magic Castle')
    expect(a).toEqual(placeholderStyle('Magic Castle'))
    expect(a.background).toMatch(/^linear-gradient\(135deg, hsl\(\d+ \d+% \d+%\), hsl\(\d+ \d+% \d+%\)\)$/)
    expect(a.background).not.toBe(placeholderStyle('Dragon Blast').background)
  })
})
