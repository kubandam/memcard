import { blobKindParam, saveKeyParam } from '../../../../../utils/libraryRoute'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    await svc.deleteBlob(id, blobKindParam(event), saveKeyParam(event))
    return {}
  }),
)
