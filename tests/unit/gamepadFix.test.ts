// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repairGamepads, type GamepadEmulatorLike, type GamepadHandlerLike } from '../../app/utils/gamepadFix'

/** The real EmulatorJS 4.2.3 GamepadHandler, loaded as a browser script would be. */
const source = readFileSync(join(process.cwd(), 'tests/fixtures/ejs/gamepad.js'), 'utf8')
type HandlerCtor = new () => GamepadHandlerLike & { terminate(): void }

let pads: Array<Gamepad | null> = []
function pad(index: number, pressed: number[] = []): Gamepad {
  return {
    index,
    id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0, touched: false })),
  } as unknown as Gamepad
}

/** Minimal copy of what EmulatorJS 4.2.3 wires in bindListeners() (connected + gamepadEvent). */
function fakeEmulator(Handler: HandlerCtor) {
  const inputs: Array<[number, number, number]> = []
  const emu: GamepadEmulatorLike & { gamepad: GamepadHandlerLike & { terminate(): void; on(n: string, cb: (e: never) => void): void } } = {
    gamepadSelection: ['', '', '', ''],
    gamepadLabels: [{}, {}, {}, {}],
    updateGamepadLabels: () => {},
    gamepad: new Handler() as never,
  }
  const controls = [{ 0: { value2: 'BUTTON_1' }, 3: { value2: 'START' } }]
  emu.gamepad.on('connected', (e: { gamepadIndex: number }) => {
    const sel = emu.gamepadSelection!
    for (let i = 0; i < sel.length; i++) {
      if (sel[i] === '') {
        sel[i] = emu.gamepad.gamepads[e.gamepadIndex]!.id + '_' + emu.gamepad.gamepads[e.gamepadIndex]!.index
        break
      }
    }
  })
  const gamepadEvent = (e: { type: string; gamepadIndex: number; label: string }) => {
    const player = emu.gamepadSelection!.indexOf(emu.gamepad.gamepads[e.gamepadIndex]!.id + '_' + emu.gamepad.gamepads[e.gamepadIndex]!.index)
    if (player < 0) return
    for (const [j, c] of Object.entries(controls[player] ?? {})) {
      if (c.value2 === e.label) inputs.push([player, Number(j), e.type === 'buttonup' ? 0 : 1])
    }
  }
  emu.gamepad.on('buttondown', gamepadEvent)
  emu.gamepad.on('buttonup', gamepadEvent)
  return { emu, inputs }
}

let Handler: HandlerCtor
beforeEach(() => {
  vi.useFakeTimers()
  pads = []
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads })
  new Function(source)()
  Handler = (window as unknown as { GamepadHandler: HandlerCtor }).GamepadHandler
})
afterEach(() => vi.useRealTimers())

describe('EmulatorJS 4.2.3 gamepad bug', () => {
  it('without the repair, a pad with index 1 kills polling and is never used', () => {
    const { emu, inputs } = fakeEmulator(Handler)
    pads = [null, pad(1)]
    expect(() => vi.advanceTimersByTime(20)).toThrow()
    pads = [null, pad(1, [0])]
    vi.advanceTimersByTime(100)
    expect(inputs).toEqual([])
    emu.gamepad.terminate()
  })
})

describe('repairGamepads', () => {
  it('a DualSense that comes back as index 1 drives player 1', () => {
    const { emu, inputs } = fakeEmulator(Handler)
    repairGamepads(emu)
    pads = [null, pad(1)]
    vi.advanceTimersByTime(20)
    expect(emu.gamepadSelection![0]).toMatch(/DualSense.*_1$/)
    pads = [null, pad(1, [0])]
    vi.advanceTimersByTime(20)
    pads = [null, pad(1)]
    vi.advanceTimersByTime(20)
    expect(inputs).toEqual([[0, 0, 1], [0, 0, 0]])
    emu.gamepad.terminate()
  })

  it('revives polling that an earlier exception already stopped, and assigns the known pad', () => {
    const { emu, inputs } = fakeEmulator(Handler)
    pads = [null, pad(1)]
    expect(() => vi.advanceTimersByTime(20)).toThrow() // the bug: loop is dead now
    repairGamepads(emu)
    expect(emu.gamepadSelection![0]).toMatch(/_1$/)
    pads = [null, pad(1, [9])] // START
    vi.advanceTimersByTime(20)
    expect(inputs).toEqual([[0, 3, 1]])
    emu.gamepad.terminate()
  })

  it('keeps the normal index-0 case working and is idempotent', () => {
    const { emu, inputs } = fakeEmulator(Handler)
    repairGamepads(emu)
    repairGamepads(emu)
    pads = [pad(0)]
    vi.advanceTimersByTime(20)
    pads = [pad(0, [0])]
    vi.advanceTimersByTime(20)
    expect(inputs).toEqual([[0, 0, 1]])
    emu.gamepad.terminate()
  })

  it('ignores an emulator without a gamepad handler', () => {
    expect(repairGamepads({})).toBe(false)
  })
})
