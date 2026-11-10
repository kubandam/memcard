import { describe, expect, it } from 'vitest'
import { shaderFor } from '../../app/utils/display'

describe('shaderFor', () => {
  it('maps picture styles to EmulatorJS shaders and ignores anything else', () => {
    expect(shaderFor('sharp')).toBe('disabled')
    expect(shaderFor('crt')).toBe('crt-easymode.glslp')
    expect(shaderFor('crtCurved')).toBe('crt-geom.glslp')
    expect(shaderFor(undefined)).toBeUndefined()
    expect(shaderFor('toString')).toBeUndefined()
  })
})
