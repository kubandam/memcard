/**
 * EmulatorJS 4.2.3 gamepad bugs, and the repair applied in `EJS_ready`.
 *
 * `GamepadHandler.gamepads` is a compacted list, but the emulator looks pads up with
 * `gamepads[e.gamepadIndex]`, where `gamepadIndex` is the browser's `Gamepad.index`. The two only
 * match while the only pad has index 0. A DualSense that reconnected over Bluetooth often comes back
 * as index 1, and then:
 *  - the "connected" listener throws, so the pad is never assigned to player 1;
 *  - the exception escapes `updateGamepadState()`, so `loop()` never re-arms its timer and the
 *    handler stops polling for good (every later button press is ignored, even after reconnecting).
 *
 * The repair re-points the handler's listeners through a lookup by `Gamepad.index`, never lets a
 * listener throw, restarts the polling loop, and assigns any already-known pad to a free player.
 * It also mirrors the left stick onto the D-pad (see `createStickToDpad`).
 */

interface PadSnapshot {
  index: number
  id: string
}

export interface GamepadHandlerLike {
  gamepads: Array<PadSnapshot | null | undefined>
  listeners: Record<string, ((e: GamepadEventLike) => void) | undefined>
  timeout: ReturnType<typeof setTimeout> | null
  loop(): void
}

export interface GamepadEventLike {
  type?: string
  gamepadIndex: number
  [key: string]: unknown
}

export interface GamepadEmulatorLike {
  gamepad?: GamepadHandlerLike
  gamepadSelection?: string[]
  gamepadLabels?: unknown[]
  updateGamepadLabels?: () => void
  started?: boolean
  settingsMenu?: { style: { display: string } }
  isPopupOpen?: () => boolean
  gameManager?: { simulateInput(player: number, index: number, value: number): void }
}

/** RetroPad indexes of the D-pad in EmulatorJS controls. */
const DPAD = { up: 4, down: 5, left: 6, right: 7 } as const
/** Stick travel that presses a direction, and the lower point that releases it (no flicker). */
const PRESS_AT = 0.5
const RELEASE_AT = 0.3

/**
 * The PS1 core emulates the original digital pad unless a game is switched to analog, so the left
 * stick does nothing in most games (and Crash 1 & co. never read it). Mirror it onto the D-pad.
 */
export function createStickToDpad(emu: GamepadEmulatorLike) {
  const held = new Map<string, -1 | 0 | 1>()
  return (e: GamepadEventLike, player: number) => {
    const axis = e.axis
    if (axis !== 'LEFT_STICK_X' && axis !== 'LEFT_STICK_Y') return
    if (!emu.started || !emu.gameManager) return
    if ((emu.settingsMenu && emu.settingsMenu.style.display !== 'none') || emu.isPopupOpen?.()) return
    const value = typeof e.value === 'number' ? e.value : 0
    const key = `${player}:${axis}`
    const before = held.get(key) ?? 0
    let now: -1 | 0 | 1 = before
    if (value >= PRESS_AT) now = 1
    else if (value <= -PRESS_AT) now = -1
    else if (Math.abs(value) < RELEASE_AT) now = 0
    if (now === before) return
    held.set(key, now)
    const [neg, pos] = axis === 'LEFT_STICK_X' ? [DPAD.left, DPAD.right] : [DPAD.up, DPAD.down]
    const press = (index: number, on: boolean) => emu.gameManager!.simulateInput(player, index, on ? 1 : 0)
    if (before === -1) press(neg, false)
    if (before === 1) press(pos, false)
    if (now === -1) press(neg, true)
    if (now === 1) press(pos, true)
  }
}

const REPAIRED = Symbol.for('memcard.gamepadRepaired')

const padKey = (p: PadSnapshot) => `${p.id}_${p.index}`

/** Puts every known pad that no player uses into the first free player slot. */
export function assignKnownPads(emu: GamepadEmulatorLike): void {
  const sel = emu.gamepadSelection
  const pads = emu.gamepad?.gamepads
  if (!sel || !pads) return
  let changed = false
  for (const pad of pads) {
    if (!pad) continue
    const key = padKey(pad)
    if (sel.includes(key)) continue
    const free = sel.indexOf('')
    if (free < 0) break
    sel[free] = key
    changed = true
  }
  if (changed) {
    try {
      emu.updateGamepadLabels?.()
    } catch {
      // Labels are cosmetic (the Controls menu); input already works.
    }
  }
}

export function repairGamepads(emu: GamepadEmulatorLike): boolean {
  const handler = emu.gamepad
  if (!handler?.listeners || !Array.isArray(handler.gamepads)) return false
  const marked = handler as unknown as Record<symbol, boolean>
  if (marked[REPAIRED]) return true
  marked[REPAIRED] = true

  const stickToDpad = createStickToDpad(emu)
  // The emulator's listeners take an *array position* where they say gamepadIndex.
  for (const name of ['connected', 'axischanged', 'buttondown', 'buttonup'] as const) {
    const original = handler.listeners[name]
    if (typeof original !== 'function' && name !== 'axischanged') continue
    handler.listeners[name] = (e) => {
      const position = handler.gamepads.findIndex((p) => p?.index === e.gamepadIndex)
      if (position < 0) return
      try {
        original?.({ ...e, gamepadIndex: position })
      } catch {
        // A throwing listener would stop the polling loop for good.
      }
      if (name !== 'axischanged') return
      try {
        const pad = handler.gamepads[position]
        const player = pad ? (emu.gamepadSelection ?? []).indexOf(padKey(pad)) : -1
        if (player >= 0) stickToDpad(e, player)
      } catch {
        // see above
      }
    }
  }
  // "disconnected" already looks the pad up by Gamepad.index; only keep it from throwing.
  const disconnected = handler.listeners.disconnected
  if (typeof disconnected === 'function') {
    handler.listeners.disconnected = (e) => {
      try {
        disconnected(e)
      } catch {
        // see above
      }
    }
  }

  // Restart polling in case an earlier exception already killed it.
  if (handler.timeout !== null) clearTimeout(handler.timeout)
  handler.timeout = null
  try {
    handler.loop()
  } catch {
    // loop() re-arms itself only after a clean pass; the wrapped listeners make that the norm.
  }
  assignKnownPads(emu)
  return true
}
