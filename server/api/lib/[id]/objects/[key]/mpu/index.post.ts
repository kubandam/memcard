import { objectPath, requireObjectKey, requireOwner } from '../../../../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const key = requireObjectKey(getRouterParam(event, 'key')!)
  const store = useLibraryStore(event)
  await requireOwner(event, store, id)
  const mpu = await useBindings(event).R2.createMultipartUpload(objectPath(id, key))
  await store.putUpload(mpu.uploadId, id, key, mpu.uploadId)
  return { uploadId: mpu.uploadId }
})
