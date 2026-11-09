import { describe, expect, it } from 'vitest'
import { RETROPAD_PS1_LABELS, buildEjsGlobals, readKeyboardMapping } from '../../app/utils/emulatorjs'

describe('buildEjsGlobals', () => {
  const file = new File(['x'], 'g.chd')
  it('sets the psx core, File input and name', () => {
    const g = buildEjsGlobals({ file, gameName: 'g.chd', base: 'https://cdn.example/data/', color: '#f2f2f2' })
    expect(g.EJS_core).toBe('psx')
    expect(g.EJS_gameUrl).toBe(file)
    expect(g.EJS_gameName).toBe('g.chd')
    expect(g.EJS_pathtodata).toBe('https://cdn.example/data/')
    expect(g.EJS_startOnLoaded).toBe(true)
    expect(g.EJS_threads).toBe(false)
    expect(g.EJS_color).toBe('#f2f2f2')
    expect(g.EJS_language).toBe('en-US')
    expect(g).not.toHaveProperty('EJS_biosUrl')
  })

  it('never emits EJS_biosUrl (EmulatorJS 4.2.3 cannot take a File there; the BIOS goes through the FS hook)', () => {
    const g = buildEjsGlobals({ file, gameName: 'g.chd', base: '/emulatorjs/data/', color: '#000' })
    expect(Object.keys(g)).not.toContain('EJS_biosUrl')
  })
})

describe('readKeyboardMapping', () => {
  it('maps RetroPad indices to PS1 labels using keyMap for key names', () => {
    const emu = {
      controls: { 0: { 0: { value: 88, value2: 'BUTTON_2' }, 8: { value: 90, value2: 'BUTTON_1' }, 4: { value: 38, value2: 'DPAD_UP' }, 14: { value: 0, value2: 'LEFT_STICK' } } },
      keyMap: { 88: 'x', 90: 'z', 38: 'up arrow', 0: '' },
    }
    expect(readKeyboardMapping(emu)).toEqual([
      { button: 'Cross', key: 'x' },
      { button: 'D-pad Up', key: 'up arrow' },
      { button: 'Circle', key: 'z' },
      { button: 'L3', key: '' },
    ])
  })

  it('returns [] for an unexpected shape', () => {
    expect(readKeyboardMapping(undefined)).toEqual([])
    expect(readKeyboardMapping({})).toEqual([])
  })

  it('labels cover the 24 RetroPad inputs', () => {
    expect(Object.keys(RETROPAD_PS1_LABELS)).toHaveLength(24)
    expect(RETROPAD_PS1_LABELS[1]).toBe('Square')
    expect(RETROPAD_PS1_LABELS[9]).toBe('Triangle')
    expect(RETROPAD_PS1_LABELS[13]).toBe('R2')
  })
})
