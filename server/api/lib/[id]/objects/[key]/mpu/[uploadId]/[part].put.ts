import { notFound, objectPath, requireObjectKey, requireOwner } from '../../../../../../../utils/libraryAuth'

const MAX_PART = 32 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const key = requireObjectKey(getRouterParam(event, 'key')!)
  const uploadId = decodeURIComponent(getRouterParam(event, 'uploadId')!)
  const part = Number(getRouterParam(event, 'part'))
  if (!Number.isInteger(part) || part < 1 || part > 10_000) notFound()
  const store = useLibraryStore(event)
  await requireOwner(event, store, id)
  const up = await store.getUpload(uploadId)
  if (!up || up.libraryId !== id || up.key !== key) notFound()
  const body = await readRawBody(event, false)
  if (!body || body.length === 0 || body.length > MAX_PART) throw createError({ statusCode: 400, statusMessage: 'Bad part' })
  const uploaded = await useBindings(event).R2.resumeMultipartUpload(objectPath(id, key), uploadId).uploadPart(part, body)
  return { etag: uploaded.etag }
})
