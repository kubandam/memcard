import { ref, type Ref } from 'vue'
import type { CloudGame, LibraryManifest, LibraryUsage } from '~~/shared/types/library'
import { fromBase64Url, toBase64Url } from '~~/shared/utils/bytes'
import { decryptJson, encryptJson } from '~~/shared/utils/chunkCrypto'
import { authVerifierHex, deriveLibraryKeys, deriveRootKey, formatRecoveryKey, parseSecret, type LibraryKeys } from '~~/shared/utils/libraryKeys'
import type { LocalGame } from '~~/shared/types/game'
import { newGameKey, newObjectKey } from '~~/shared/utils/chunkCrypto'
import { ApiError, createCloudApi, type CloudApi } from '~/utils/cloudApi'
import { ResumeMismatchError, uploadObject } from '~/utils/cloudUpload'
import { downloadObject } from '~/utils/cloudDownload'
import { deleteUploadState, getBlob, getGame, getSetting, getUploadStates, putUploadState, setSetting } from '~/utils/localDb'
import type { LibraryNotice } from './useLocalLibrary'

/** A cloud upload in progress, kept in local settings so it can resume after a reload. */
interface PendingUpload {
  localGameId: string
  kGame: string
  fileKeys: string[]
  coverKey?: string
  done: string[]
}

export interface UploadProgress {
  gameId: string
  title: string
  done: number
  total: number
}

export type CloudStatus = 'closed' | 'opening' | 'open' | 'error'

/** sessionStorage key holding base64url(K_root) while a library is open in this tab. */
export const SESSION_KEY = 'memcard.cloud.kroot'

type ApiFactory = (opts: { libraryId: string; kAuth: Uint8Array }) => CloudApi
let apiFactory: ApiFactory = (opts) => createCloudApi(opts)

/** Test seam: replace the HTTP client. */
export function __setCloudApiFactory(factory: ApiFactory) {
  apiFactory = factory
}

interface CloudState {
  status: Ref<CloudStatus>
  libraryId: Ref<string | null>
  games: Ref<CloudGame[]>
  usage: Ref<LibraryUsage | null>
  notice: Ref<LibraryNotice | null>
  busy: Ref<string | null>
  recoveryKey: Ref<string | null>
  uploadProgress: Ref<UploadProgress | null>
  keys: LibraryKeys | null
  api: CloudApi | null
  etag: string | null
  manifest: LibraryManifest
}

let state: CloudState | null = null

function freshState(): CloudState {
  return {
    status: ref('closed'),
    libraryId: ref(null),
    games: ref([]),
    usage: ref(null),
    notice: ref(null),
    busy: ref(null),
    recoveryKey: ref(null),
    uploadProgress: ref(null),
    keys: null,
    api: null,
    etag: null,
    manifest: { version: 1, games: [] },
  }
}

/** Test seam: forget the module-level singleton. */
export function __resetCloudForTests() {
  state = null
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function useCloudLibrary() {
  const s = (state ??= freshState())

  function requireOpen(): { keys: LibraryKeys; api: CloudApi } {
    if (!s.keys || !s.api) throw new Error('Library is not open')
    return { keys: s.keys, api: s.api }
  }

  function setManifest(manifest: LibraryManifest, etag: string | null) {
    s.manifest = manifest
    s.etag = etag
    s.games.value = [...manifest.games]
  }

  async function loadManifest(): Promise<void> {
    const { keys, api } = requireOpen()
    const res = await api.getManifest()
    if (!res) return setManifest({ version: 1, games: [] }, null)
    setManifest(await decryptJson<LibraryManifest>(keys.kLib, res.bytes), res.etag)
  }

  async function refreshUsage() {
    if (!s.api) return
    try {
      s.usage.value = await s.api.usage()
    } catch {
      s.usage.value = null
    }
  }

  async function activate(kRoot: Uint8Array): Promise<LibraryKeys> {
    const keys = await deriveLibraryKeys(kRoot)
    s.keys = keys
    s.api = apiFactory({ libraryId: keys.libraryId, kAuth: keys.kAuth })
    return keys
  }

  function remember(kRoot: Uint8Array, keys: LibraryKeys) {
    s.libraryId.value = keys.libraryId
    s.status.value = 'open'
    session()?.setItem(SESSION_KEY, toBase64Url(kRoot))
  }

  function reset() {
    s.keys = null
    s.api = null
    s.etag = null
    s.manifest = { version: 1, games: [] }
    s.games.value = []
    s.usage.value = null
    s.libraryId.value = null
    s.status.value = 'closed'
  }

  async function rootFromSecret(secret: string): Promise<Uint8Array> {
    const parsed = parseSecret(secret)
    return parsed.kind === 'recovery' ? parsed.kRoot : deriveRootKey(parsed.password)
  }

  async function openWithRoot(kRoot: Uint8Array): Promise<boolean> {
    s.status.value = 'opening'
    s.notice.value = null
    try {
      const keys = await activate(kRoot)
      await loadManifest()
      remember(kRoot, keys)
      await refreshUsage()
      return true
    } catch (err) {
      reset()
      if (err instanceof ApiError && err.status === 404) s.notice.value = { kind: 'error', key: 'cloud.noLibrary' }
      else if (err instanceof ApiError) s.notice.value = { kind: 'error', key: 'cloud.network' }
      else s.notice.value = { kind: 'error', key: 'cloud.cannotDecrypt' }
      return false
    }
  }

  async function open(secret: string): Promise<boolean> {
    s.status.value = 'opening'
    return openWithRoot(await rootFromSecret(secret))
  }

  async function create(password: string, invite: string): Promise<{ recoveryKey: string } | null> {
    s.status.value = 'opening'
    s.notice.value = null
    const kRoot = await rootFromSecret(password)
    try {
      const keys = await activate(kRoot)
      await s.api!.createLibrary(keys.libraryId, await authVerifierHex(keys.kAuth), invite.trim())
      setManifest({ version: 1, games: [] }, null)
      await saveManifest(() => {})
      remember(kRoot, keys)
      await refreshUsage()
      s.recoveryKey.value = formatRecoveryKey(kRoot)
      return { recoveryKey: s.recoveryKey.value }
    } catch (err) {
      reset()
      if (err instanceof ApiError && err.status === 404) s.notice.value = { kind: 'error', key: 'cloud.badInvite' }
      else if (err instanceof ApiError && err.status === 409) s.notice.value = { kind: 'error', key: 'cloud.exists' }
      else if (err instanceof ApiError && err.status === 429) s.notice.value = { kind: 'error', key: 'cloud.tooMany' }
      else s.notice.value = { kind: 'error', key: 'cloud.network' }
      return null
    }
  }

  function close() {
    s.recoveryKey.value = null
    session()?.removeItem(SESSION_KEY)
    reset()
  }

  async function restore(): Promise<void> {
    if (s.status.value === 'open') return
    const stored = session()?.getItem(SESSION_KEY)
    if (!stored) return
    try {
      const kRoot = fromBase64Url(stored)
      if (kRoot.length === 32) await openWithRoot(kRoot)
    } catch {
      session()?.removeItem(SESSION_KEY)
    }
  }

  /** Applies `mutate` to the manifest and saves it; on a concurrent change (412) reloads and retries once. */
  async function saveManifest(mutate: (m: LibraryManifest) => void): Promise<void> {
    const { keys, api } = requireOpen()
    for (let attempt = 0; ; attempt++) {
      const next = structuredClone(s.manifest)
      mutate(next)
      try {
        const etag = await api.putManifest(await encryptJson(keys.kLib, next), s.etag)
        setManifest(next, etag)
        return
      } catch (err) {
        if (err instanceof ApiError && err.status === 412 && attempt === 0) {
          await loadManifest()
          continue
        }
        throw err
      }
    }
  }

  const pendingKey = () => `cloudPending.${s.libraryId.value}`

  async function getPending(): Promise<PendingUpload[]> {
    return ((await getSetting<PendingUpload[]>(pendingKey())) ?? []).map((p) => ({ ...p }))
  }

  async function savePending(list: PendingUpload[]) {
    await setSetting(pendingKey(), structuredClone(list))
  }

  /** True when a game with the same title and size is already in the online library. */
  function isInCloud(local: LocalGame): boolean {
    return s.games.value.some((g) => g.title === local.title && g.sizeBytes === local.sizeBytes)
  }

  /** Uploads one object, resuming from saved state for the same object key when present. */
  async function uploadOne(api: CloudApi, blob: File, kGame: Uint8Array, objectKey: string, onBytes: (n: number) => void) {
    const libraryId = s.libraryId.value!
    const resume = (await getUploadStates(libraryId)).find((st) => st.objectKey === objectKey)
    return uploadObject(api, blob, kGame, objectKey, {
      libraryId,
      resume,
      onProgress: (n) => onBytes(n),
      saveState: (st) => putUploadState(st),
      clearState: (id) => deleteUploadState(id),
    })
  }

  async function uploadGame(local: LocalGame): Promise<void> {
    const { api } = requireOpen()
    s.notice.value = null
    let pending = (await getPending()).find((p) => p.localGameId === local.id)
    const list = await getPending()
    if (!pending) {
      pending = {
        localGameId: local.id,
        kGame: toBase64Url(newGameKey()),
        fileKeys: local.files.map(() => newObjectKey()),
        coverKey: local.coverBlobKey ? newObjectKey() : undefined,
        done: [],
      }
      list.push(pending)
      await savePending(list)
    }
    const kGame = fromBase64Url(pending.kGame)
    const total = local.sizeBytes
    let finished = 0
    s.uploadProgress.value = { gameId: local.id, title: local.title, done: 0, total }
    const markDone = async (key: string) => {
      pending!.done.push(key)
      const all = await getPending()
      await savePending(all.map((p) => (p.localGameId === local.id ? pending! : p)))
    }

    try {
      const files = []
      for (let i = 0; i < local.files.length; i++) {
        const ref = local.files[i]!
        const key = pending.fileKeys[i]!
        const chunks = Math.ceil(ref.size / (4 * 1024 * 1024))
        if (!pending.done.includes(key)) {
          const blob = await getBlob(ref.blobKey)
          if (!blob) throw new Error(`Missing stored file: ${ref.name}`)
          await uploadOne(api, new File([blob], ref.name, { lastModified: local.createdAt }), kGame, key, (n) => {
            s.uploadProgress.value = { gameId: local.id, title: local.title, done: finished + n, total }
          })
          await markDone(key)
        }
        finished += ref.size
        files.push({ name: ref.name, size: ref.size, objectKey: key, chunks })
      }
      let coverSize: number | undefined
      if (pending.coverKey && local.coverBlobKey) {
        const cover = await getBlob(local.coverBlobKey)
        if (cover && !pending.done.includes(pending.coverKey)) {
          await uploadOne(api, new File([cover], 'cover', { lastModified: local.createdAt }), kGame, pending.coverKey, () => {})
          await markDone(pending.coverKey)
        }
        coverSize = cover?.size
      }
      await saveManifest((m) => {
        m.games.push({
          id: crypto.randomUUID(),
          title: local.title,
          kind: local.kind,
          primaryName: local.primaryName,
          files,
          generatedM3u: local.generatedM3u,
          coverObjectKey: coverSize ? pending!.coverKey : undefined,
          coverSize,
          sizeBytes: local.sizeBytes,
          createdAt: Date.now(),
          lastPlayedAt: null,
          kGame: pending!.kGame,
        })
      })
      await savePending((await getPending()).filter((p) => p.localGameId !== local.id))
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        // Roll back: remove what this game already stored, forget the pending entry.
        for (const key of pending.done) await api.deleteObject(key).catch(() => undefined)
        for (const st of await getUploadStates(s.libraryId.value!)) {
          if ([...pending.fileKeys, pending.coverKey].includes(st.objectKey)) {
            await api.abortUpload(st.objectKey, st.uploadId).catch(() => undefined)
            await deleteUploadState(st.id)
          }
        }
        await savePending((await getPending()).filter((p) => p.localGameId !== local.id))
        s.notice.value = { kind: 'error', key: 'cloud.quota' }
      } else if (err instanceof ResumeMismatchError) {
        await savePending((await getPending()).filter((p) => p.localGameId !== local.id))
        s.notice.value = { kind: 'error', key: 'cloud.uploadFailed' }
      } else {
        s.notice.value = { kind: 'error', key: 'cloud.uploadFailed' }
      }
    } finally {
      s.uploadProgress.value = null
      await refreshUsage()
    }
  }

  /** Continues uploads that were interrupted (tab closed, network lost) using the local copies. */
  async function resumeUploads(): Promise<void> {
    for (const p of await getPending()) {
      const local = await getGame(p.localGameId)
      if (local) await uploadGame(local)
      else await savePending((await getPending()).filter((x) => x.localGameId !== p.localGameId))
    }
  }

  async function deleteGame(id: string): Promise<void> {
    const { api } = requireOpen()
    const game = s.games.value.find((g) => g.id === id)
    if (!game) return
    for (const f of game.files) await api.deleteObject(f.objectKey).catch(() => undefined)
    if (game.coverObjectKey) await api.deleteObject(game.coverObjectKey).catch(() => undefined)
    await saveManifest((m) => {
      m.games = m.games.filter((g) => g.id !== id)
    })
    await refreshUsage()
  }

  const coverCache = new Map<string, string>()

  /** Decrypts a game's cover into an object URL (cached for the page's lifetime). */
  async function coverUrl(game: CloudGame): Promise<string | undefined> {
    if (!game.coverObjectKey || !game.coverSize) return undefined
    const cached = coverCache.get(game.coverObjectKey)
    if (cached) return cached
    try {
      const { api } = requireOpen()
      const bytes = await downloadObject(api, { name: 'cover', size: game.coverSize, objectKey: game.coverObjectKey, chunks: Math.ceil(game.coverSize / (4 * 1024 * 1024)) }, fromBase64Url(game.kGame))
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
      coverCache.set(game.coverObjectKey, url)
      return url
    } catch {
      return undefined
    }
  }

  async function renameGame(id: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) return
    await saveManifest((m) => {
      const g = m.games.find((x) => x.id === id)
      if (g) g.title = trimmed
    })
  }

  return {
    status: s.status,
    libraryId: s.libraryId,
    games: s.games,
    usage: s.usage,
    notice: s.notice,
    busy: s.busy,
    recoveryKey: s.recoveryKey,
    uploadProgress: s.uploadProgress,
    isInCloud,
    uploadGame,
    resumeUploads,
    deleteGame,
    renameGame,
    coverUrl,
    open,
    create,
    close,
    restore,
    saveManifest,
    refreshUsage,
    /** Internal access for the upload/download helpers in this composable's later additions. */
    _internal: () => requireOpen(),
  }
}
