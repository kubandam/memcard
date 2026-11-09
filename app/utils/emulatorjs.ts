/**
 * EmulatorJS 4.2.3 facts verified in the Task 0 spike (Chromium, CDN build, pcsx_rearmed):
 *
 * - `EJS_gameUrl` accepts a `File` object; the file name is taken from `File.name`
 *   (format detection depends on the extension, so always pass a named File).
 * - Callbacks: `EJS_ready(emulator)` fires when the core is ready, then `EJS_onGameStart()`
 *   once the game runs. `EJS_onSaveSave({ save, screenshot, format })` replaces the default
 *   .srm download from the menu's "Export save".
 * - Current keyboard mapping: `EJS_emulator.controls[player][idx] = { value: <keyCode>, value2: <gamepad> }`.
 *   Human-readable defaults: `EJS_emulator.defaultControllers[player][idx].value` ('x', 'enter', 'up arrow').
 *   keyCode → name: `EJS_emulator.keyMap[keyCode]`.
 * - RetroPad index → PS1 button, confirmed on screen with a controller test program:
 *   0 Cross, 1 Square, 8 Circle, 9 Triangle, 10 L1, 13 R2 (rest follows the standard RetroPad layout).
 * - Memory card save: `saveFileExt === 'srm'`, path `/data/saves/PCSX-ReARMed/<EJS_gameName>.srm`.
 * - pcsx_rearmed only boots ISO9660 images whose directory entries carry the `;1` version suffix
 *   and contain SYSTEM.CNF (or PSX.EXE). hdiutil output lacks `;1`; see scripts/build-fixture.mjs.
 */
export const EJS_VERSION = '4.2.3'

/** RetroPad input index → PS1 control name, in RetroPad order. */
export const RETROPAD_PS1_LABELS: Readonly<Record<number, string>> = {
  0: 'Cross',
  1: 'Square',
  2: 'Select',
  3: 'Start',
  4: 'D-pad Up',
  5: 'D-pad Down',
  6: 'D-pad Left',
  7: 'D-pad Right',
  8: 'Circle',
  9: 'Triangle',
  10: 'L1',
  11: 'R1',
  12: 'L2',
  13: 'R2',
  14: 'L3',
  15: 'R3',
  16: 'Left stick →',
  17: 'Left stick ←',
  18: 'Left stick ↓',
  19: 'Left stick ↑',
  20: 'Right stick →',
  21: 'Right stick ←',
  22: 'Right stick ↓',
  23: 'Right stick ↑',
}

/** EmulatorJS default keyboard keys for player 1 (from `defaultControllers[0]`, 4.2.3). */
export const DEFAULT_KEYS: Readonly<Record<number, string>> = {
  0: 'x',
  1: 's',
  2: 'v',
  3: 'enter',
  4: 'up arrow',
  5: 'down arrow',
  6: 'left arrow',
  7: 'right arrow',
  8: 'z',
  9: 'a',
  10: 'q',
  11: 'e',
  12: 'tab',
  13: 'r',
  14: '',
  15: '',
  16: 'h',
  17: 'f',
  18: 'g',
  19: 't',
  20: 'l',
  21: 'j',
  22: 'k',
  23: 'i',
}

export interface KeyBinding {
  button: string
  key: string
}

interface EmulatorLike {
  controls?: Record<string | number, Record<string | number, { value?: unknown }>>
  keyMap?: Record<string | number, string>
}

/** Reads player 1's current keyboard mapping from a running EmulatorJS instance. */
export function readKeyboardMapping(emu: unknown): KeyBinding[] {
  const e = emu as EmulatorLike | undefined
  const player = e?.controls?.[0]
  if (!player || typeof player !== 'object') return []
  const out: KeyBinding[] = []
  for (const [idx, binding] of Object.entries(player)) {
    const label = RETROPAD_PS1_LABELS[Number(idx)]
    if (!label) continue
    const code = binding?.value
    const key = typeof code === 'number' ? (e?.keyMap?.[code] ?? '') : typeof code === 'string' ? code : ''
    out.push({ button: label, key })
  }
  return out
}

export interface EjsOptions {
  file: File
  gameName: string
  /** Data folder URL with trailing slash. */
  base: string
  color: string
  biosFile?: File
}

export function buildEjsGlobals(opts: EjsOptions): Record<string, unknown> {
  const globals: Record<string, unknown> = {
    EJS_player: '#game',
    EJS_core: 'psx',
    EJS_gameUrl: opts.file,
    EJS_gameName: opts.gameName,
    EJS_pathtodata: opts.base,
    EJS_startOnLoaded: true,
    EJS_threads: false,
    EJS_color: opts.color,
    EJS_backgroundColor: '#000000',
    EJS_language: 'en-US',
    EJS_disableAutoLang: true,
    EJS_askBeforeExit: false,
    EJS_defaultOptions: {},
  }
  if (opts.biosFile) globals.EJS_biosUrl = opts.biosFile
  return globals
}
