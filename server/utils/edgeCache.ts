import type { H3Event } from 'h3'

/**
 * Cloudflare's per-data-centre cache for encrypted object ranges.
 *
 * Objects are immutable (a new upload gets a new random key) and hold only ciphertext, so a range
 * can be kept at the edge: the next PC in the same region (or the same PC after its local cache was
 * cleared) gets it at line speed instead of through R2. The cache is consulted only *after* the
 * route has authorised the caller, and the Cache API is never served to clients by itself, so
 * nothing becomes reachable without the library's keys or a valid share code.
 */

const TTL_SECONDS = 7 * 24 * 3600

interface EdgeHit {
  bytes: Uint8Array
  contentRange: string
  size: number
}

function edgeCache(): Cache | null {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null
  } catch {
    return null
  }
}

function keyFor(event: H3Event, libraryId: string, objectKey: string, start: number, end: number): string {
  // Never routed: the Worker answers every request itself, this URL only names the cache entry.
  return `${getRequestURL(event).origin}/__edge/lib/${libraryId}/obj/${objectKey}/${start}-${end}`
}

export async function edgeGet(event: H3Event, libraryId: string, objectKey: string, start: number, end: number): Promise<EdgeHit | null> {
  const cache = edgeCache()
  if (!cache) return null
  try {
    const hit = await cache.match(keyFor(event, libraryId, objectKey, start, end))
    if (!hit) return null
    const contentRange = hit.headers.get('x-content-range')
    const size = Number(hit.headers.get('x-object-size'))
    if (!contentRange || !Number.isFinite(size)) return null
    return { bytes: new Uint8Array(await hit.arrayBuffer()), contentRange, size }
  } catch {
    return null
  }
}

export function edgePut(event: H3Event, libraryId: string, objectKey: string, start: number, end: number, value: EdgeHit): void {
  const cache = edgeCache()
  if (!cache) return
  const res = new Response(value.bytes as BodyInit, {
    headers: {
      'cache-control': `public, max-age=${TTL_SECONDS}`,
      'content-type': 'application/octet-stream',
      'x-content-range': value.contentRange,
      'x-object-size': String(value.size),
    },
  })
  const put = cache.put(keyFor(event, libraryId, objectKey, start, end), res).catch(() => undefined)
  const ctx = (event.context as { cloudflare?: { context?: { waitUntil?: (p: Promise<unknown>) => void } } }).cloudflare?.context
  if (ctx?.waitUntil) ctx.waitUntil(put)
}
