export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const shareId = getRouterParam(event, 'shareId') ?? ''
    if (!SHARE_ID_RE.test(shareId)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    await svc.revokeShare(id, shareId)
    return {}
  }),
)
