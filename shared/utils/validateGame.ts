import type { CloudGame } from '../types/library'

const FILE_EXT = /\.(chd|pbp|iso|img|bin|cue|m3u|zip|7z)$/i

/**
 * A file name that is safe to write into the emulator's virtual FS root: one path segment,
 * no traversal or control characters, a game-image extension, at most 255 characters.
 */
export function isSafeFileName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false
  return FILE_EXT.test(name)
}

/**
 * Structural and safety check for a game description that came from someone else's manifest
 * or share payload. Untrusted names must never reach the emulator FS unchecked.
 */
export function validateCloudGame(value: unknown): value is CloudGame {
  const g = value as CloudGame | null
  if (!g || typeof g !== 'object') return false
  if (typeof g.id !== 'string' || typeof g.title !== 'string' || typeof g.kGame !== 'string') return false
  if (g.kind !== 'single' && g.kind !== 'multi') return false
  if (!Array.isArray(g.files) || g.files.length === 0 || g.files.length > 64) return false
  const names = new Set<string>()
  for (const f of g.files) {
    if (!f || !isSafeFileName(f.name) || typeof f.objectKey !== 'string' || !Number.isFinite(f.size) || f.size < 0) return false
    if (names.has(f.name.toLowerCase())) return false
    names.add(f.name.toLowerCase())
  }
  if (!isSafeFileName(g.primaryName)) return false
  if (g.generatedM3u !== undefined) {
    if (typeof g.generatedM3u !== 'string') return false
    const lines = g.generatedM3u.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (!lines.length || !lines.every((l) => names.has(l.toLowerCase()))) return false
    if (names.has(g.primaryName.toLowerCase())) return false
  } else if (!names.has(g.primaryName.toLowerCase())) {
    return false
  }
  if (g.kind === 'single' && (g.files.length !== 1 || g.generatedM3u !== undefined)) return false
  return true
}
