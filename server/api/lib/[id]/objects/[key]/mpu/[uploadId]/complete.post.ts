import { hardLimit, notFound, objectPath, requireObjectKey, requireOwner } from '../../../../../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const key = requireObjectKey(getRouterParam(event, 'key')!)
  const uploadId = decodeURIComponent(getRouterParam(event, 'uploadId')!)
  const store = useLibraryStore(event)
  await requireOwner(event, store, id)
  const up = await store.getUpload(uploadId)
  if (!up || up.libraryId !== id || up.key !== key) notFound()
  const body = await readBody<{ parts?: { partNumber: number; etag: string }[]; size?: number }>(event)
  const parts = body?.parts ?? []
  const size = Number(body?.size)
  if (!parts.length || !Number.isFinite(size) || size <= 0) throw createError({ statusCode: 400, statusMessage: 'Bad request' })
  const env = useBindings(event)
  const mpu = env.R2.resumeMultipartUpload(objectPath(id, key), uploadId)
  if ((await store.totalBytes()) + size > hardLimit(env)) {
    await mpu.abort().catch(() => undefined)
    await store.deleteUpload(uploadId)
    throw createError({ statusCode: 413, statusMessage: 'quota', data: { code: 'quota' } })
  }
  const obj = await mpu.complete(parts)
  await store.addObject(id, key, obj.size)
  await store.deleteUpload(uploadId)
  return { size: obj.size }
})
