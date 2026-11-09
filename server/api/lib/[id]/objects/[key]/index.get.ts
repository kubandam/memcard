export default defineEventHandler((event) =>
  readerAction(event, 'object', async ({ id, key, svc }) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(getHeader(event, 'range') ?? '')
    const res = await svc.getObject(id, key!, m ? { start: Number(m[1]), end: Number(m[2]) } : null)
    setHeader(event, 'accept-ranges', 'bytes')
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'cache-control', 'no-store')
    setHeader(event, 'content-length', String(res.length))
    if (res.contentRange) {
      setResponseStatus(event, 206)
      setHeader(event, 'content-range', res.contentRange)
    }
    return res.body
  }),
)
