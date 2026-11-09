import { objectPath, requireObjectKey, requireOwner } from '../../../../../utils/libraryAuth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const key = requireObjectKey(getRouterParam(event, 'key')!)
  const store = useLibraryStore(event)
  await requireOwner(event, store, id)
  await useBindings(event).R2.delete(objectPath(id, key))
  await store.removeObject(id, key)
  return {}
})
