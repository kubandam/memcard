import { MAX_SAVE_BYTES } from '../../../../utils/libraryService'
import { saveKeyParam } from '../../../../utils/libraryRoute'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    if (Number(getHeader(event, 'content-length') ?? 0) > MAX_SAVE_BYTES) throw createError({ statusCode: 400, statusMessage: 'Save too large' })
    const body = await readRawBody(event, false)
    await svc.putSave(id, saveKeyParam(event), new Uint8Array(body ?? []))
    return {}
  }),
)
