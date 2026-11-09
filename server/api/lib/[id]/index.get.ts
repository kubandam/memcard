import { SOFT_LIMIT, hardLimit, requireOwner } from '../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const store = useLibraryStore(event)
  const row = await requireOwner(event, store, getRouterParam(event, 'id')!)
  return { bytesUsed: row.bytesUsed, softLimit: SOFT_LIMIT, hardLimit: hardLimit(useBindings(event)) }
})
