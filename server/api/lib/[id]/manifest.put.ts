const MAX_MANIFEST = 2 * 1024 * 1024

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const body = await readRawBody(event, false)
    if (!body || body.length === 0 || body.length > MAX_MANIFEST) throw createError({ statusCode: 400, statusMessage: 'Bad manifest' })
    const etag = await svc.putManifest(id, getHeader(event, 'if-match') || null, new Uint8Array(body))
    return { etag }
  }),
)
