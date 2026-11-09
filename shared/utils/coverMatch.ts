/** Cover lookup against the libretro-thumbnails "Named_Boxarts" file list (PlayStation). */

export const THUMBNAIL_RAW_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails/Sony_-_PlayStation/master/Named_Boxarts/'

/** Lowercase, drop "(USA)"-style groups, "[SLUS-…]" tags, the extension and punctuation. */
export function normalizeGameName(name: string): string {
  return name
    .replace(/\.(png|jpg|jpeg|webp|chd|pbp|iso|img|bin|cue|m3u|zip|7z)$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const REGION_RANK = ['(usa)', '(world)', '(europe)', '(japan)']

function regionRank(name: string): number {
  const lower = name.toLowerCase()
  const i = REGION_RANK.findIndex((r) => lower.includes(r))
  return i === -1 ? REGION_RANK.length : i
}

/**
 * Picks the best thumbnail file name for a game title: exact normalized match first (USA preferred),
 * then a unique prefix match. Returns null when nothing is clear enough to use without asking.
 */
export function pickCover(title: string, names: string[]): string | null {
  const wanted = normalizeGameName(title)
  if (!wanted) return null
  const exact = names.filter((n) => normalizeGameName(n) === wanted)
  if (exact.length) return exact.sort((a, b) => regionRank(a) - regionRank(b))[0]!
  const prefix = names.filter((n) => normalizeGameName(n).startsWith(`${wanted} `))
  const distinctTitles = new Set(prefix.map((n) => normalizeGameName(n)))
  if (distinctTitles.size === 1) return prefix.sort((a, b) => regionRank(a) - regionRank(b))[0]!
  return null
}

/** Reads the file names out of an Apache-style directory listing. */
export function parseThumbnailIndex(html: string): string[] {
  const names: string[] = []
  for (const m of html.matchAll(/href="([^"]+\.png)"/gi)) {
    try {
      names.push(decodeURIComponent(m[1]!))
    } catch {
      // skip undecodable entries
    }
  }
  return names
}
