/** Deterministic dark duotone gradient for games without cover art. */
export function placeholderStyle(title: string): { background: string } {
  let hash = 2166136261
  for (const ch of title) {
    hash ^= ch.codePointAt(0)!
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const hue = hash % 360
  const hue2 = (hue + 24) % 360
  return { background: `linear-gradient(135deg, hsl(${hue} 45% 28%), hsl(${hue2} 50% 10%))` }
}
