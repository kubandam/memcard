/**
 * Promise rejections from the emulator that do not affect play: a denied screen Wake Lock and the
 * browser refusing audio autoplay before the first click. They must not surface as error pages.
 */
export function isHarmlessRejection(reason: unknown): boolean {
  const r = reason as { name?: string; message?: string } | null
  if (!r || r.name !== 'NotAllowedError') return false
  return /wake ?lock|play\(\) failed|user didn'?t interact/i.test(r.message ?? '')
}
