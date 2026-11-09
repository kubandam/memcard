import { manifestKey, requireOwner } from '../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await requireOwner(event, useLibraryStore(event), id)
  const obj = await useBindings(event).R2.get(manifestKey(id))
  if (!obj) {
    setResponseStatus(event, 204)
    return null
  }
  setHeader(event, 'etag', obj.etag)
  setHeader(event, 'content-type', 'application/octet-stream')
  setHeader(event, 'cache-control', 'no-store')
  return new Uint8Array(await obj.arrayBuffer())
})
