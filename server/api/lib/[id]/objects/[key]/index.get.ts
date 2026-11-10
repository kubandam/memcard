export default defineEventHandler((event) =>
  readerAction(event, 'object', async ({ id, key, svc }) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(getHeader(event, 'range') ?? '')
    const range = m ? { start: Number(m[1]), end: Number(m[2]) } : null
    setHeader(event, 'accept-ranges', 'bytes')
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'cache-control', 'no-store')

    // Ranged reads (all the app does) go through the edge cache; the caller is already authorised.
    if (range) {
      const hit = await edgeGet(event, id, key!, range.start, range.end)
      if (hit) {
        setResponseStatus(event, 206)
        setHeader(event, 'content-range', hit.contentRange)
        setHeader(event, 'content-length', String(hit.bytes.length))
        setHeader(event, 'x-edge-cache', 'hit')
        return hit.bytes
      }
    }

    const res = await svc.getObject(id, key!, range)
    setHeader(event, 'content-length', String(res.length))
    if (!res.contentRange) return res.body
    setResponseStatus(event, 206)
    setHeader(event, 'content-range', res.contentRange)
    if (!range) return res.body
    const bytes = res.body instanceof Uint8Array ? res.body : new Uint8Array(await new Response(res.body).arrayBuffer())
    edgePut(event, id, key!, range.start, range.end, { bytes, contentRange: res.contentRange, size: res.size })
    return bytes
  }),
)
