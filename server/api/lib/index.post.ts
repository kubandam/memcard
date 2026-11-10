import { LIBRARY_ID_RE, checkInvite, notFound } from '../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const env = useBindings(event)
  const ip = getHeader(event, 'cf-connecting-ip') ?? 'local'
  // MEMCARD_DEV_NO_RATELIMIT is only ever set in local .dev.vars (parallel e2e tests create many libraries).
  if (env.RL_CREATE && env.MEMCARD_DEV_NO_RATELIMIT !== '1' && !(await env.RL_CREATE.limit({ key: ip })).success) {
    throw createError({ statusCode: 429, statusMessage: 'Too many requests' })
  }
  const body = await readBody<{ id?: string; authVerifier?: string; invite?: string }>(event)
  if (!checkInvite(env.MEMCARD_INVITES, body?.invite)) notFound()
  if (!body?.id || !LIBRARY_ID_RE.test(body.id) || !/^[0-9a-f]{64}$/.test(body.authVerifier ?? '')) {
    throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  }
  const result = await useLibraryStore(event).createLibrary(body.id, body.authVerifier!)
  if (result === 'exists') throw createError({ statusCode: 409, statusMessage: 'Exists' })
  setResponseStatus(event, 201)
  return {}
})
