import { describe, expect, it, vi } from 'vitest'
import {
  PS_VIRTUAL_GAMEPAD,
  audioSuspended,
  canFullscreen,
  controllerConnected,
  resumeAudio,
  toggleFullscreen,
  wantsVirtualGamepad,
  watchVirtualGamepad,
} from '../../app/utils/touchPlay'

const pad = { connected: true }

describe('virtual gamepad choice', () => {
  it('shows the on-screen pad only on a touch screen without a controller', () => {
    const coarse = () => ({ matches: true })
    expect(wantsVirtualGamepad({ maxTouchPoints: 5, getGamepads: () => [null, null] }, coarse)).toBe(true)
    expect(wantsVirtualGamepad({ maxTouchPoints: 5, getGamepads: () => [null, pad] }, coarse)).toBe(false)
    expect(wantsVirtualGamepad({ maxTouchPoints: 0, getGamepads: () => [] }, coarse)).toBe(false)
  })

  it('leaves touch-screen laptops alone (mouse or trackpad is the main pointer)', () => {
    const fine = () => ({ matches: false })
    const coarse = () => ({ matches: true })
    expect(wantsVirtualGamepad({ maxTouchPoints: 10, getGamepads: () => [] }, fine)).toBe(false)
    expect(wantsVirtualGamepad({ maxTouchPoints: 10, getGamepads: () => [] }, coarse)).toBe(true)
  })

  it('treats a throwing or missing getGamepads as no controller', () => {
    expect(controllerConnected({ getGamepads: () => { throw new Error('denied') } })).toBe(false)
    expect(controllerConnected({})).toBe(false)
    expect(controllerConnected({ getGamepads: () => [{ connected: false }] })).toBe(false)
  })

  function touchWindow(pads: Array<{ connected: boolean } | null>) {
    const win = new EventTarget() as unknown as Window
    Object.assign(win, { navigator: { maxTouchPoints: 5, getGamepads: () => pads }, matchMedia: () => ({ matches: true }) })
    return win
  }
  function touch(win: Window, target: Element = document.createElement('canvas')) {
    const e = new Event('pointerdown')
    Object.defineProperties(e, { pointerType: { value: 'touch' }, target: { value: target } })
    win.dispatchEvent(e)
  }

  it('starts with no pad: a game starts clean even before the controller is seen', () => {
    const toggle = vi.fn()
    watchVirtualGamepad({ toggleVirtualGamepad: toggle }, undefined, touchWindow([null]))
    expect(toggle).toHaveBeenLastCalledWith(false)
  })

  it('brings the pad up when the game is touched without a controller, and drops it once one connects', () => {
    const pads: Array<{ connected: boolean } | null> = [null]
    const win = touchWindow(pads)
    const toggle = vi.fn()
    const seen: boolean[] = []
    const stop = watchVirtualGamepad({ toggleVirtualGamepad: toggle }, (s) => seen.push(s), win)
    touch(win)
    expect(toggle).toHaveBeenLastCalledWith(true)
    pads[0] = pad
    win.dispatchEvent(new Event('gamepadconnected'))
    expect(toggle).toHaveBeenLastCalledWith(false)
    pads[0] = null
    win.dispatchEvent(new Event('gamepaddisconnected'))
    expect(toggle).toHaveBeenLastCalledWith(true)
    stop()
    win.dispatchEvent(new Event('gamepadconnected'))
    expect(seen).toEqual([false, true, false, true])
  })

  it('ignores taps on the page buttons and mouse clicks', () => {
    const win = touchWindow([null])
    const toggle = vi.fn()
    watchVirtualGamepad({ toggleVirtualGamepad: toggle }, undefined, win)
    const btn = document.createElement('button')
    touch(win, btn)
    const mouse = new Event('pointerdown')
    Object.defineProperties(mouse, { pointerType: { value: 'mouse' }, target: { value: document.createElement('canvas') } })
    win.dispatchEvent(mouse)
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenLastCalledWith(false)
  })

  it('never lets a broken emulator pad stop the game', () => {
    const win = new EventTarget() as unknown as Window
    Object.assign(win, { navigator: { maxTouchPoints: 0 } })
    expect(() => watchVirtualGamepad({ toggleVirtualGamepad: () => { throw new Error('x') } }, undefined, win)).not.toThrow()
  })
})

describe('PS_VIRTUAL_GAMEPAD', () => {
  it('passes EmulatorJS 4.2.3 validation (location + id + input_value, inputValues for pads)', () => {
    for (const c of PS_VIRTUAL_GAMEPAD) {
      expect(c.location).toBeTruthy()
      if (c.type === 'dpad' || c.type === 'zone') expect(c.inputValues).toHaveLength(4)
      else {
        expect(c.id).toBeTruthy()
        expect(typeof c.input_value).toBe('number')
      }
    }
  })

  it('maps the PlayStation symbols to their RetroPad buttons', () => {
    const byText = Object.fromEntries(PS_VIRTUAL_GAMEPAD.filter((c) => c.text).map((c) => [c.text, c.input_value]))
    expect(byText).toMatchObject({ '✕': 0, '□': 1, '○': 8, '△': 9, L1: 10, R1: 11, L2: 12, R2: 13, Select: 2, Start: 3 })
  })
})

describe('fullscreen', () => {
  it('reports support from either the standard or the webkit flag', () => {
    expect(canFullscreen({ fullscreenEnabled: true } as Document)).toBe(true)
    expect(canFullscreen({ webkitFullscreenEnabled: true } as unknown as Document)).toBe(true)
    expect(canFullscreen({ fullscreenEnabled: false } as Document)).toBe(false)
  })

  it('falls back to the webkit-prefixed request on older iPadOS', async () => {
    const webkitRequestFullscreen = vi.fn()
    const doc = { fullscreenElement: null, defaultView: { navigator: { maxTouchPoints: 0 } } } as unknown as Document
    await toggleFullscreen({ webkitRequestFullscreen } as unknown as HTMLElement, doc)
    expect(webkitRequestFullscreen).toHaveBeenCalled()
  })

  it('leaves fullscreen when already in it', async () => {
    const exitFullscreen = vi.fn(async () => {})
    const requestFullscreen = vi.fn()
    const doc = { fullscreenElement: {}, exitFullscreen } as unknown as Document
    await toggleFullscreen({ requestFullscreen } as unknown as HTMLElement, doc)
    expect(exitFullscreen).toHaveBeenCalled()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })
})

describe('audio', () => {
  it('treats the WebKit interrupted state as blocked too', () => {
    expect(audioSuspended({ Module: { AL: { currentCtx: { audioCtx: { state: 'interrupted' } } } } })).toBe(true)
    expect(audioSuspended({ Module: { AL: { currentCtx: { audioCtx: { state: 'running' } } } } })).toBe(false)
  })

  it('asks iOS to play game sound even in silent mode', async () => {
    const session = { type: 'auto' }
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: session })
    await resumeAudio({ Module: { AL: { currentCtx: { audioCtx: { state: 'running', resume: async () => {} } } } } })
    expect(session.type).toBe('playback')
    Reflect.deleteProperty(navigator, 'audioSession')
  })

  it('detects a suspended context and resumes it', async () => {
    const ctx = { state: 'suspended', resume: vi.fn(async () => { ctx.state = 'running' }) }
    const emu = { Module: { AL: { currentCtx: { audioCtx: ctx } } } }
    expect(audioSuspended(emu)).toBe(true)
    expect(await resumeAudio(emu)).toBe(true)
    expect(audioSuspended(emu)).toBe(false)
  })

  it('is a no-op before the core has sound', async () => {
    expect(audioSuspended(undefined)).toBe(false)
    expect(await resumeAudio({ Module: {} })).toBe(false)
  })
})
