import { toBase64Url } from '~~/shared/utils/bytes'
import { ServiceError } from '../../utils/libraryService'

/** Public: resolves a share id to what the code holder needs to unwrap it. Rate-limited per IP. */
export default defineEventHandler(async (event) => {
  const env = useBindings(event)
  const ip = getHeader(event, 'cf-connecting-ip') ?? 'local'
  if (env.RL_SHARE && !(await env.RL_SHARE.limit({ key: ip })).success) throw createError({ statusCode: 429, statusMessage: 'Too many requests' })
  const shareId = getRouterParam(event, 'shareId') ?? ''
  if (!SHARE_ID_RE.test(shareId)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setHeader(event, 'cache-control', 'no-store')
  try {
    const s = await serviceFor(event).lookupShare(shareId)
    return { libraryId: s.libraryId, gameId: s.gameId, wrapped: toBase64Url(s.wrapped) }
  } catch (err) {
    if (err instanceof ServiceError) throw createError({ statusCode: err.status, statusMessage: 'Not found' })
    throw err
  }
})
