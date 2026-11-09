import { saveKeyParam } from '../../../../utils/libraryRoute'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    await svc.deleteSave(id, saveKeyParam(event))
    return {}
  }),
)
