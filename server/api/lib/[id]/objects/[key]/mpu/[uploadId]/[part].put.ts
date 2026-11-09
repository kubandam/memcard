import { MAX_PART_BYTES } from '../../../../../../../utils/libraryService'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, key, svc }) => {
    const length = Number(getHeader(event, 'content-length') ?? 0)
    if (length > MAX_PART_BYTES) throw createError({ statusCode: 400, statusMessage: 'Part too large' })
    const body = await readRawBody(event, false)
    return svc.uploadPart(id, key!, routeUploadId(event), Number(getRouterParam(event, 'part')), new Uint8Array(body ?? []))
  }),
)
