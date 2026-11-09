import { notFound, objectPath, requireObjectKey, requireOwner } from '../../../../../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const key = requireObjectKey(getRouterParam(event, 'key')!)
  const uploadId = decodeURIComponent(getRouterParam(event, 'uploadId')!)
  const store = useLibraryStore(event)
  await requireOwner(event, store, id)
  const up = await store.getUpload(uploadId)
  if (!up || up.libraryId !== id) notFound()
  await useBindings(event).R2.resumeMultipartUpload(objectPath(id, key), uploadId).abort().catch(() => undefined)
  await store.deleteUpload(uploadId)
  return {}
})
