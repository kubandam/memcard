import { createError, type H3Event } from 'h3'
import { SOFT_LIMIT, hardLimit, requireObjectKey, requireOwner } from './libraryAuth'
import { createLibraryService, ServiceError, type LibraryService } from './libraryService'

/** Authenticates the owner of `:id`, then runs `fn` with the service; maps ServiceError to HTTP. */
export async function ownerAction<T>(event: H3Event, fn: (ctx: { id: string; key: string | null; svc: LibraryService }) => Promise<T>): Promise<T> {
  const store = useLibraryStore(event)
  const env = useBindings(event)
  const id = getRouterParam(event, 'id')!
  await requireOwner(event, store, id)
  const rawKey = getRouterParam(event, 'key')
  const key = rawKey ? requireObjectKey(rawKey) : null
  try {
    return await fn({ id, key, svc: createLibraryService({ store, r2: env.R2, hardLimit: hardLimit(env), libraryLimit: SOFT_LIMIT }) })
  } catch (err) {
    if (err instanceof ServiceError) {
      throw createError({ statusCode: err.status, statusMessage: err.status === 404 ? 'Not found' : (err.code ?? 'Error'), data: err.code ? { code: err.code } : undefined })
    }
    throw err
  }
}

export function routeUploadId(event: H3Event): string {
  return decodeURIComponent(getRouterParam(event, 'uploadId')!)
}
