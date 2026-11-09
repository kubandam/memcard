export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, key, svc }) => {
    await svc.abortUpload(id, key!, routeUploadId(event))
    return {}
  }),
)
