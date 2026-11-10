import { blobKindParam, saveKeyParam } from '../../../../../utils/libraryRoute'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const bytes = await svc.getBlob(id, blobKindParam(event), saveKeyParam(event))
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'cache-control', 'no-store')
    return bytes
  }),
)
