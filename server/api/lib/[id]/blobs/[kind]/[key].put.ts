import { MAX_BLOB_BYTES } from '../../../../../utils/libraryService'
import { blobKindParam, saveKeyParam } from '../../../../../utils/libraryRoute'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const kind = blobKindParam(event)
    if (Number(getHeader(event, 'content-length') ?? 0) > MAX_BLOB_BYTES[kind]) throw createError({ statusCode: 400, statusMessage: 'Too large' })
    const body = await readRawBody(event, false)
    await svc.putBlob(id, kind, saveKeyParam(event), new Uint8Array(body ?? []))
    return {}
  }),
)
