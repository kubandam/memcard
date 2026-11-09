export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, key, svc }) => {
    const body = await readBody<{ parts?: { partNumber: number; etag: string }[] }>(event)
    const parts = (body?.parts ?? []).filter((p) => Number.isInteger(p?.partNumber) && typeof p?.etag === 'string')
    return svc.completeUpload(id, key!, routeUploadId(event), parts)
  }),
)
