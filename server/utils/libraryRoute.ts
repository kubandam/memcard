import { createError, type H3Event } from 'h3'
import { LIBRARY_ID_RE, SOFT_LIMIT, hardLimit, notFound, requireObjectKey, requireOwner } from './libraryAuth'
import { BLOB_KINDS, createLibraryService, ServiceError, type BlobKind, type LibraryService } from './libraryService'

/** Authenticates the owner of `:id`, then runs `fn` with the service; maps ServiceError to HTTP. */
export async function ownerAction<T>(event: H3Event, fn: (ctx: { id: string; key: string | null; svc: LibraryService }) => Promise<T>): Promise<T> {
  const store = useLibraryStore(event)
  const env = useBindings(event)
  const id = getRouterParam(event, 'id')!
  await requireOwner(event, store, id)
  const rawKey = getRouterParam(event, 'key')
  const key = rawKey ? requireObjectKey(rawKey) : null
  void env
  try {
    return await fn({ id, key, svc: serviceFor(event) })
  } catch (err) {
    return toHttp(err)
  }
}

function toHttp(err: unknown): never {
  if (err instanceof ServiceError) {
    throw createError({ statusCode: err.status, statusMessage: err.status === 404 ? 'Not found' : (err.code ?? 'Error'), data: err.code ? { code: err.code } : undefined })
  }
  throw err
}

export function serviceFor(event: H3Event): LibraryService {
  const env = useBindings(event)
  return createLibraryService({ store: useLibraryStore(event), r2: env.R2, hardLimit: hardLimit(env), libraryLimit: SOFT_LIMIT })
}

export const SHARE_ID_RE = /^[0-9a-hjkmnp-tv-z]{26}$/

/**
 * Read-only access for the owner (Bearer K_auth) or a share holder (`Authorization: Share <shareId>`),
 * scoped by `what`: the manifest, or the object `:key`.
 */
export async function readerAction<T>(event: H3Event, what: 'manifest' | 'object', fn: (ctx: { id: string; key: string | null; svc: LibraryService }) => Promise<T>): Promise<T> {
  const id = getRouterParam(event, 'id')!
  if (!LIBRARY_ID_RE.test(id)) notFound()
  const rawKey = getRouterParam(event, 'key')
  const key = rawKey ? requireObjectKey(rawKey) : null
  const svc = serviceFor(event)
  const share = /^Share ([0-9a-hjkmnp-tv-z]{26})$/.exec(getHeader(event, 'authorization') ?? '')
  try {
    if (share) await svc.authorizeShare(share[1]!, id, what === 'manifest' ? { manifest: true } : { key: key! })
    else await requireOwner(event, useLibraryStore(event), id)
    return await fn({ id, key, svc })
  } catch (err) {
    return toHttp(err)
  }
}

export function routeUploadId(event: H3Event): string {
  return decodeURIComponent(getRouterParam(event, 'uploadId')!)
}

/** `:key` blob route param, same shape as object keys; anything else is a 404. */
export function saveKeyParam(event: H3Event): string {
  return requireObjectKey(getRouterParam(event, 'key') ?? '')
}

/** `:kind` blob route param: save | state | shot; anything else is a 404. */
export function blobKindParam(event: H3Event): BlobKind {
  const kind = getRouterParam(event, 'kind') as BlobKind
  if (!BLOB_KINDS.includes(kind)) notFound()
  return kind
}
