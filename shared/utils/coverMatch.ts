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

const REGIONS = ['usa', 'world', 'europe', 'japan', 'germany', 'france', 'spain', 'italy', 'australia', 'asia', 'korea'] as const
const DEFAULT_RANK = ['usa', 'world', 'europe', 'japan']

/** The region named in a No-Intro/Redump style file name, e.g. "(Europe)". */
export function regionOf(name: string): string | null {
  const lower = name.toLowerCase()
  for (const region of REGIONS) if (lower.includes(`(${region})`) || lower.includes(`(${region},`) || lower.includes(`, ${region})`)) return region
  return null
}

function rankBy(preferred: string | null) {
  const order = preferred ? [preferred, ...DEFAULT_RANK.filter((r) => r !== preferred)] : DEFAULT_RANK
  const rank = (name: string) => {
    const lower = name.toLowerCase()
    const i = order.findIndex((r) => lower.includes(`(${r})`) || lower.includes(`(${r},`) || lower.includes(`, ${r})`))
    return i === -1 ? order.length : i
  }
  return (a: string, b: string) => rank(a) - rank(b)
}

/**
 * Picks the best thumbnail file name for a game title or file name: exact normalized match first,
 * preferring the region named in the input (then USA, World, Europe, Japan), then a unique prefix
 * match. Returns null when nothing is clear enough to use without asking.
 */
export function pickCover(title: string, names: string[]): string | null {
  const wanted = normalizeGameName(title)
  if (!wanted) return null
  const byRegion = rankBy(regionOf(title))
  const exact = names.filter((n) => normalizeGameName(n) === wanted)
  if (exact.length) return exact.sort(byRegion)[0]!
  const prefix = names.filter((n) => normalizeGameName(n).startsWith(`${wanted} `))
  const distinctTitles = new Set(prefix.map((n) => normalizeGameName(n)))
  if (distinctTitles.size === 1) return prefix.sort(byRegion)[0]!
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
