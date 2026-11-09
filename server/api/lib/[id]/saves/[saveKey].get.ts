import { saveKeyParam } from '../../../../utils/libraryRoute'

export default defineEventHandler((event) =>
  ownerAction(event, async ({ id, svc }) => {
    const bytes = await svc.getSave(id, saveKeyParam(event))
    setHeader(event, 'content-type', 'application/octet-stream')
    setHeader(event, 'cache-control', 'no-store')
    return bytes
  }),
)
