import { fromBase64Url } from '~~/shared/utils/bytes'
import { OBJECT_KEY_RE } from '../../../../utils/libraryAuth'

const MAX_WRAPPED = 64 * 1024

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const body = await readBody<{ shareId?: string; gameId?: string | null; allowedKeys?: string[]; wrapped?: string }>(event)
    const keys = Array.isArray(body?.allowedKeys) ? body.allowedKeys : []
    const gameId = typeof body?.gameId === 'string' && /^[0-9a-f-]{36}$/.test(body.gameId) ? body.gameId : null
    let wrapped: Uint8Array
    try {
      wrapped = fromBase64Url(body?.wrapped ?? '')
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Bad request' })
    }
    if (!SHARE_ID_RE.test(body?.shareId ?? '') || wrapped.length === 0 || wrapped.length > MAX_WRAPPED || keys.length > 200 || !keys.every((k) => OBJECT_KEY_RE.test(k)) || (gameId === null && keys.length > 0) || (gameId !== null && keys.length === 0)) {
      throw createError({ statusCode: 400, statusMessage: 'Bad request' })
    }
    await svc.createShare(id, { shareId: body!.shareId!, gameId, allowedKeys: keys, wrapped })
    setResponseStatus(event, 201)
    return {}
  }),
)
