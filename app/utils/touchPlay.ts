/**
 * Tablets and phones (EmulatorJS 4.2.3).
 *
 * - EmulatorJS shows its on-screen gamepad on "mobile" user agents (Android, iPhone) even while a
 *   real controller is connected, and labels the face buttons X / Y / A / B. We decide instead:
 *   on-screen pad only on a touch screen with no controller connected, with PlayStation symbols.
 * - Element fullscreen exists on desktop, Android and iPad (prefixed on older iPadOS), not on iPhone.
 * - Safari starts the emulator's AudioContext suspended unless a touch/click started it; a gamepad
 *   press does not count, so the page offers "Tap for sound".
 */

export interface VirtualControl {
  type: 'button' | 'dpad' | 'zone'
  id: string
  location: 'left' | 'right' | 'center' | 'top'
  text?: string
  left?: number | string
  right?: number | string
  top?: number | string
  bold?: boolean
  block?: boolean
  fontSize?: number
  input_value?: number
  inputValues?: number[]
  joystickInput?: boolean
}

/**
 * PS1 on-screen pad. RetroPad indexes: 0 Cross, 1 Square, 8 Circle, 9 Triangle, 10 L1, 11 R1,
 * 12 L2, 13 R2, 2 Select, 3 Start, 4–7 D-pad (see `RETROPAD_PS1_LABELS`). Face buttons sit where
 * they are on a DualShock; EmulatorJS's speed buttons (Fast / Slow) are left out on purpose.
 */
export const PS_VIRTUAL_GAMEPAD: readonly VirtualControl[] = [
  { type: 'button', text: '△', id: 'triangle', location: 'right', left: 40, bold: true, input_value: 9 },
  { type: 'button', text: '□', id: 'square', location: 'right', top: 40, bold: true, input_value: 1 },
  { type: 'button', text: '○', id: 'circle', location: 'right', left: 81, top: 40, bold: true, input_value: 8 },
  { type: 'button', text: '✕', id: 'cross', location: 'right', left: 40, top: 80, bold: true, input_value: 0 },
  { type: 'dpad', id: 'dpad', location: 'left', left: '50%', top: '50%', joystickInput: false, inputValues: [4, 5, 6, 7] },
  { type: 'button', text: 'L1', id: 'l1', location: 'left', left: 3, top: -90, fontSize: 15, block: true, input_value: 10 },
  { type: 'button', text: 'L2', id: 'l2', location: 'left', left: 3, top: -140, fontSize: 15, block: true, input_value: 12 },
  { type: 'button', text: 'R1', id: 'r1', location: 'right', right: 3, top: -90, fontSize: 15, block: true, input_value: 11 },
  { type: 'button', text: 'R2', id: 'r2', location: 'right', right: 3, top: -140, fontSize: 15, block: true, input_value: 13 },
  { type: 'button', text: 'Select', id: 'select', location: 'center', left: -5, fontSize: 15, block: true, input_value: 2 },
  { type: 'button', text: 'Start', id: 'start', location: 'center', left: 60, fontSize: 15, block: true, input_value: 3 },
]

interface NavigatorLike {
  maxTouchPoints?: number
  getGamepads?: () => ArrayLike<{ connected?: boolean } | null>
}

type MatchMedia = ((query: string) => { matches: boolean }) | undefined

function defaultMatchMedia(): MatchMedia {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined
}

/**
 * True on a tablet or phone: a touch screen that is the main way to point. A touch-screen laptop
 * (mouse / trackpad first) does not count, so keyboard players there get no on-screen pad.
 */
export function hasTouchScreen(nav: NavigatorLike = navigator, matchMedia: MatchMedia = defaultMatchMedia()): boolean {
  if ((nav.maxTouchPoints ?? 0) <= 0) return false
  return matchMedia ? matchMedia('(pointer: coarse)').matches : true
}

/** True when the browser reports at least one connected controller. */
export function controllerConnected(nav: NavigatorLike = navigator): boolean {
  try {
    const pads = nav.getGamepads?.()
    if (!pads) return false
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i]
      if (pad && pad.connected !== false) return true
    }
    return false
  } catch {
    return false
  }
}

/** The on-screen pad is for touch screens with no controller in hand. */
export function wantsVirtualGamepad(nav: NavigatorLike = navigator, matchMedia: MatchMedia = defaultMatchMedia()): boolean {
  return hasTouchScreen(nav, matchMedia) && !controllerConnected(nav)
}

export interface VirtualPadEmulatorLike {
  toggleVirtualGamepad?: (show: boolean) => void
}

/** Touches on these are the player using the page's own controls, not asking for a touch pad. */
const NOT_THE_GAME = 'button, a, input, label, [role=dialog], .overlay, .sound-pill, .ejs_menu_bar, .ejs_virtualGamepad_parent, .ejs_popup_container, .ejs_settings_parent'

/**
 * Drives EmulatorJS's on-screen pad. A game starts clean: browsers only reveal a controller after
 * one of its buttons is pressed, so "no controller yet" says nothing at start. The pad appears once
 * the player touches the game itself on a touch screen with no controller, and goes away the moment
 * a controller shows up. `onChange` gets the new state (the page centres the picture without it).
 * Returns a function that stops watching.
 */
export function watchVirtualGamepad(emu: VirtualPadEmulatorLike, onChange?: (shown: boolean) => void, win: Window = window): () => void {
  let touched = false
  const sync = () => {
    const show = touched && wantsVirtualGamepad(win.navigator, typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : undefined)
    try {
      emu.toggleVirtualGamepad?.(show)
    } catch {
      // A missing pad is never worth stopping the game for.
    }
    onChange?.(show)
  }
  const onPointer = (e: Event) => {
    const ev = e as PointerEvent
    if (touched || ev.pointerType !== 'touch') return
    const target = ev.target as Element | null
    if (target?.closest?.(NOT_THE_GAME)) return
    touched = true
    sync()
  }
  sync()
  win.addEventListener('gamepadconnected', sync)
  win.addEventListener('gamepaddisconnected', sync)
  win.addEventListener('pointerdown', onPointer, true)
  return () => {
    win.removeEventListener('gamepadconnected', sync)
    win.removeEventListener('gamepaddisconnected', sync)
    win.removeEventListener('pointerdown', onPointer, true)
  }
}

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }

/** iPhone Safari has no element fullscreen; the page then hides the button (Add to Home Screen covers it). */
export function canFullscreen(doc: Document = document): boolean {
  const d = doc as FullscreenDocument
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled)
}

function fullscreenElement(doc: FullscreenDocument): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

/** Enters fullscreen (or leaves it when already there); on touch screens also turns the picture sideways. */
export async function toggleFullscreen(el: HTMLElement | null, doc: Document = document): Promise<void> {
  const d = doc as FullscreenDocument
  if (fullscreenElement(d)) {
    try {
      if (d.exitFullscreen) await d.exitFullscreen()
      else d.webkitExitFullscreen?.()
    } catch {
      // already left
    }
    return
  }
  if (!el) return
  const target = el as FullscreenElement
  try {
    if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' })
    else await target.webkitRequestFullscreen?.()
  } catch {
    return
  }
  // Android only (iPadOS has no orientation lock); a tablet already held sideways is unaffected.
  const orientation = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation
  if (hasTouchScreen(doc.defaultView?.navigator ?? navigator, defaultMatchMedia()) && orientation?.lock) {
    await orientation.lock('landscape').catch(() => undefined)
  }
}

interface AudioCtxLike {
  state?: string
  resume?: () => Promise<void>
}

interface AudioEmulatorLike {
  Module?: { AL?: { currentCtx?: { audioCtx?: AudioCtxLike } | null; contexts?: Record<string, { audioCtx?: AudioCtxLike } | null> | Array<{ audioCtx?: AudioCtxLike } | null> } }
}

/** Every Web Audio context the core opened (normally one). */
function audioContexts(emu: unknown): AudioCtxLike[] {
  const al = (emu as AudioEmulatorLike | undefined)?.Module?.AL
  if (!al) return []
  const out = new Set<AudioCtxLike>()
  if (al.currentCtx?.audioCtx) out.add(al.currentCtx.audioCtx)
  for (const c of Object.values(al.contexts ?? {})) if (c?.audioCtx) out.add(c.audioCtx)
  return [...out]
}

/**
 * True when the game's sound is held back: 'suspended' until a touch (Safari autoplay rule), or
 * WebKit's own 'interrupted' (another app or a call took the audio).
 */
export function audioSuspended(emu: unknown): boolean {
  return audioContexts(emu).some((c) => c.state !== undefined && c.state !== 'running' && c.state !== 'closed')
}

/**
 * Game sound on iPhone / iPad plays even with the silent switch on (or silent mode set in Control
 * Centre); by default WebKit treats page audio like a ringtone and mutes it. iOS 17+ only.
 */
export function preferPlaybackAudio(nav: Navigator = navigator): void {
  try {
    const session = (nav as Navigator & { audioSession?: { type?: string } }).audioSession
    if (session && session.type !== 'playback') session.type = 'playback'
  } catch {
    // Older WebKit: nothing to do.
  }
}

/**
 * Must run inside a touchend / click / keydown handler: WebKit does not count touchstart or
 * pointerdown (or a gamepad press) as permission to play sound.
 */
export async function resumeAudio(emu: unknown): Promise<boolean> {
  preferPlaybackAudio()
  const ctxs = audioContexts(emu)
  if (!ctxs.length) return false
  await Promise.all(ctxs.map((c) => c.resume?.().catch(() => undefined)))
  return !audioSuspended(emu)
}
