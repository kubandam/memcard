export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const m = await svc.getManifest(id)
    setHeader(event, 'cache-control', 'no-store')
    if (!m) {
      setResponseStatus(event, 204)
      return null
    }
    setHeader(event, 'etag', m.etag)
    setHeader(event, 'content-type', 'application/octet-stream')
    return m.bytes
  }),
)
