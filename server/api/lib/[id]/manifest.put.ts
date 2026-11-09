import { manifestKey, requireOwner } from '../../../utils/libraryAuth'

const MAX_MANIFEST = 2 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const store = useLibraryStore(event)
  const row = await requireOwner(event, store, id)
  const ifMatch = getHeader(event, 'if-match') ?? null
  if ((row.manifestEtag ?? null) !== (ifMatch || null)) throw createError({ statusCode: 412, statusMessage: 'Manifest changed' })
  const body = await readRawBody(event, false)
  if (!body || body.length === 0 || body.length > MAX_MANIFEST) throw createError({ statusCode: 400, statusMessage: 'Bad manifest' })
  const put = await useBindings(event).R2.put(manifestKey(id), body)
  await store.setManifestEtag(id, put!.etag)
  return { etag: put!.etag }
})
