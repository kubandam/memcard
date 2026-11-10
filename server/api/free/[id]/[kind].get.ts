import manifest from '~~/content/free-games.json'
import { freeFileFor, parseFreeGames } from '~~/shared/utils/freeGames'

const games = parseFreeGames(manifest)

/** Public download of a free game's disc image or cover — only for games listed in the manifest. */
export default defineEventHandler(async (event) => {
  const kind = getRouterParam(event, 'kind')
  const key = kind === 'file' || kind === 'cover' ? freeFileFor(games, getRouterParam(event, 'id') ?? '', kind) : null
  const bucket = useBindings(event).FREE
  if (!key || !bucket) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const obj = await bucket.get(key)
  if (!obj) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setHeader(event, 'content-type', kind === 'cover' ? 'image/png' : 'application/octet-stream')
  setHeader(event, 'content-length', String(obj.size))
  setHeader(event, 'etag', obj.httpEtag)
  setHeader(event, 'cache-control', 'public, max-age=86400')
  return obj.body
})
