function hashTitle(title: string): number {
  let hash = 2166136261
  for (const ch of title) {
    hash ^= ch.codePointAt(0)!
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

/** Stable hue (0–359) for a title; used for the tile accent and the placeholder art. */
export function accentHue(title: string): number {
  return hashTitle(title) % 360
}

/** Deterministic saturated duotone gradient for games without cover art. */
export function placeholderStyle(title: string): { background: string } {
  const hue = accentHue(title)
  const hue2 = (hue + 40) % 360
  return { background: `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${hue2} 75% 18%))` }
}
