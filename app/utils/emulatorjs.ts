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
