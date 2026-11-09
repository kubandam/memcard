import { objectPath, requireObjectKey, requireOwner, notFound } from '../../../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const key = requireObjectKey(getRouterParam(event, 'key')!)
  await requireOwner(event, useLibraryStore(event), id)
  const r2 = useBindings(event).R2
  const range = /^bytes=(\d+)-(\d+)$/.exec(getHeader(event, 'range') ?? '')
  const obj = range
    ? await r2.get(objectPath(id, key), { range: { offset: Number(range[1]), length: Number(range[2]) - Number(range[1]) + 1 } })
    : await r2.get(objectPath(id, key))
  if (!obj || !('body' in obj)) notFound()
  setHeader(event, 'accept-ranges', 'bytes')
  setHeader(event, 'content-type', 'application/octet-stream')
  setHeader(event, 'cache-control', 'no-store')
  if (range) {
    const start = Number(range[1])
    const end = Math.min(Number(range[2]), obj.size - 1)
    setResponseStatus(event, 206)
    setHeader(event, 'content-range', `bytes ${start}-${end}/${obj.size}`)
    setHeader(event, 'content-length', String(end - start + 1))
  } else {
    setHeader(event, 'content-length', String(obj.size))
  }
  return obj.body
})
