import { ref, toRaw, type Ref } from 'vue'
import type { CloudGame, LibraryManifest, LibraryUsage } from '~~/shared/types/library'
import { fromBase64Url, toBase64Url } from '~~/shared/utils/bytes'
import { decryptJson, encryptJson } from '~~/shared/utils/chunkCrypto'
import { authVerifierHex, deriveLibraryKeys, deriveRootKey, formatRecoveryKey, parseSecret, type LibraryKeys } from '~~/shared/utils/libraryKeys'
import type { LocalGame } from '~~/shared/types/game'
import { newGameKey, newObjectKey } from '~~/shared/utils/chunkCrypto'
import { deriveShareKeys, formatShareCode, newShareSecret, wrapPayload } from '~~/shared/utils/shareCodes'
import type { SharePayload } from '~~/shared/types/share'
import { ApiError, createCloudApi, type CloudApi } from '~/utils/cloudApi'
import { ResumeMismatchError, UploadCancelledError, uploadObject } from '~/utils/cloudUpload'
import { DecryptError, downloadObject } from '~/utils/cloudDownload'
import { StorageError } from '~/utils/localDb'
import { addGame, deleteSetting, deleteUploadState, getBlob, getGame, getSetting, getUploadStates, putUploadState, setCover, setSetting } from '~/utils/localDb'
import type { LibraryNotice } from './useLocalLibrary'

/** A cloud upload in progress, kept in local settings so it can resume after a reload. */
interface PendingUpload {
  localGameId: string
  kGame: string
  fileKeys: string[]
  coverKey?: string
  done: string[]
}

export interface IssuedShare {
  id: string
  kind: 'game' | 'library'
  label: string
  gameId: string | null
  createdAt: number
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
/** IndexedDB setting holding base64url(K_root) when "Stay open on this PC" is on. */
export const REMEMBER_KEY = 'cloudKeyRemembered'

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
  remembered: Ref<boolean>
  uploadProgress: Ref<UploadProgress | null>
  downloadProgress: Ref<UploadProgress | null>
  issuedShares: Ref<IssuedShare[]>
  keys: LibraryKeys | null
  api: CloudApi | null
  /** Bumped whenever the open library changes; long operations stop when it moves. */
  generation: number
  inFlight: Set<string>
  resuming: Promise<void> | null
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
    remembered: ref(false),
    uploadProgress: ref(null),
    downloadProgress: ref(null),
    issuedShares: ref([]),
    keys: null,
    api: null,
    generation: 0,
    inFlight: new Set(),
    resuming: null,
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
    s.generation++
    s.keys = keys
    s.api = apiFactory({ libraryId: keys.libraryId, kAuth: keys.kAuth })
    return keys
  }

  async function remember(kRoot: Uint8Array, keys: LibraryKeys, onDevice?: boolean) {
    s.libraryId.value = keys.libraryId
    s.status.value = 'open'
    session()?.setItem(SESSION_KEY, toBase64Url(kRoot))
    if (onDevice === true) {
      await setSetting(REMEMBER_KEY, toBase64Url(kRoot)).catch(() => undefined)
      s.remembered.value = true
    } else if (onDevice === false) {
      await deleteSetting(REMEMBER_KEY).catch(() => undefined)
      s.remembered.value = false
    }
  }

  function reset() {
    s.generation++
    s.keys = null
    s.api = null
    s.etag = null
    s.manifest = { version: 1, games: [] }
    s.games.value = []
    s.issuedShares.value = []
    s.usage.value = null
    s.libraryId.value = null
    s.status.value = 'closed'
  }

  async function rootFromSecret(secret: string): Promise<Uint8Array> {
    const parsed = parseSecret(secret)
    return parsed.kind === 'recovery' ? parsed.kRoot : deriveRootKey(parsed.password.trim())
  }

  /** 'missing' = no library for this key (safe to forget it); 'error' = network/server trouble (keep it). */
  async function openWithRoot(kRoot: Uint8Array, onDevice?: boolean): Promise<'ok' | 'missing' | 'error'> {
    s.status.value = 'opening'
    s.notice.value = null
    try {
      const keys = await activate(kRoot)
      await loadManifest()
      await remember(kRoot, keys, onDevice)
      await refreshUsage()
      return 'ok'
    } catch (err) {
      reset()
      if (err instanceof ApiError && err.status === 404) {
        s.notice.value = { kind: 'error', key: 'cloud.noLibrary' }
        return 'missing'
      }
      // AES-GCM failure is an OperationError; anything else (TypeError from fetch, 5xx, 429) is the network.
      const decryptFailed = (err as { name?: string })?.name === 'OperationError'
      s.notice.value = { kind: 'error', key: decryptFailed ? 'cloud.cannotDecrypt' : 'cloud.network' }
      return 'error'
    }
  }

  async function open(secret: string, opts: { remember?: boolean } = {}): Promise<boolean> {
    s.status.value = 'opening'
    return (await openWithRoot(await rootFromSecret(secret), opts.remember ?? false)) === 'ok'
  }

  async function create(password: string, invite: string, opts: { remember?: boolean } = {}): Promise<{ recoveryKey: string } | null> {
    s.status.value = 'opening'
    s.notice.value = null
    const kRoot = await rootFromSecret(password)
    try {
      const keys = await activate(kRoot)
      await s.api!.createLibrary(keys.libraryId, await authVerifierHex(keys.kAuth), invite.trim())
      setManifest({ version: 1, games: [] }, null)
      await saveManifest(() => {})
      await remember(kRoot, keys, opts.remember ?? false)
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

  async function close(): Promise<void> {
    s.recoveryKey.value = null
    s.remembered.value = false
    session()?.removeItem(SESSION_KEY)
    // Reset synchronously so running uploads see the new generation right away.
    reset()
    await deleteSetting(REMEMBER_KEY).catch(() => undefined)
  }

  async function restore(): Promise<void> {
    if (s.status.value === 'open') return
    const decode = (v: string): Uint8Array | null => {
      try {
        const k = fromBase64Url(v)
        return k.length === 32 ? k : null
      } catch {
        return null
      }
    }
    const fromSession = session()?.getItem(SESSION_KEY)
    if (fromSession) {
      const kRoot = decode(fromSession)
      const res = kRoot ? await openWithRoot(kRoot) : 'missing'
      if (res === 'ok') {
        s.remembered.value = !!(await getSetting<string>(REMEMBER_KEY).catch(() => undefined))
        return
      }
      // Keep the key through network trouble; forget it only when it is unusable or its library is gone.
      if (res === 'error') return
      session()?.removeItem(SESSION_KEY)
    }
    const fromDevice = await getSetting<string>(REMEMBER_KEY).catch(() => undefined)
    if (!fromDevice) return
    const kRoot = decode(fromDevice)
    const res = kRoot ? await openWithRoot(kRoot) : 'missing'
    if (res === 'missing') {
      await deleteSetting(REMEMBER_KEY).catch(() => undefined)
      s.remembered.value = false
      return
    }
    s.remembered.value = res === 'ok'
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

  const pendingKey = (libraryId: string) => `cloudPending.${libraryId}`

  async function getPendingFor(libraryId: string): Promise<PendingUpload[]> {
    return ((await getSetting<PendingUpload[]>(pendingKey(libraryId))) ?? []).map((p) => ({ ...p }))
  }

  async function savePendingFor(list: PendingUpload[], libraryId: string) {
    await setSetting(pendingKey(libraryId), structuredClone(list))
  }

  /** True when a game with the same title and size is already in the online library. */
  function isInCloud(local: LocalGame): boolean {
    return s.games.value.some((g) => g.title === local.title && g.sizeBytes === local.sizeBytes)
  }

  /** Uploads one object, resuming from saved state for the same object key when present. */
  async function uploadOne(api: CloudApi, libraryId: string, blob: File, kGame: Uint8Array, objectKey: string, onBytes: (n: number) => void, isCancelled: () => boolean) {
    const resume = (await getUploadStates(libraryId)).find((st) => st.objectKey === objectKey)
    return uploadObject(api, blob, kGame, objectKey, {
      libraryId,
      resume,
      isCancelled,
      onProgress: (n) => onBytes(n),
      saveState: (st) => putUploadState(st),
      clearState: (id) => deleteUploadState(id),
    })
  }

  async function uploadGame(local: LocalGame): Promise<void> {
    if (s.inFlight.has(local.id)) return
    const { api } = requireOpen()
    const gen = s.generation
    const libraryId = s.libraryId.value!
    const alive = () => s.generation === gen
    const getPending = (id = libraryId) => getPendingFor(id)
    const savePending = (list: PendingUpload[]) => savePendingFor(list, libraryId)
    s.inFlight.add(local.id)
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
          await uploadOne(api, libraryId, new File([blob], ref.name, { lastModified: local.createdAt }), kGame, key, (n) => {
            if (alive()) s.uploadProgress.value = { gameId: local.id, title: local.title, done: finished + n, total }
          }, () => !alive())
          await markDone(key)
        }
        finished += ref.size
        files.push({ name: ref.name, size: ref.size, objectKey: key, chunks })
      }
      let coverSize: number | undefined
      if (pending.coverKey && local.coverBlobKey) {
        const cover = await getBlob(local.coverBlobKey)
        if (cover && !pending.done.includes(pending.coverKey)) {
          await uploadOne(api, libraryId, new File([cover], 'cover', { lastModified: local.createdAt }), kGame, pending.coverKey, () => {}, () => !alive())
          await markDone(pending.coverKey)
        }
        coverSize = cover?.size
      }
      if (!alive()) throw new UploadCancelledError()
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
      if (err instanceof UploadCancelledError || !alive()) {
        // Library closed or switched: keep the pending state for the next time it is opened.
      } else if (err instanceof ApiError && err.status === 413) {
        // Roll back: remove what this game already stored, forget the pending entry.
        for (const key of pending.done) await api.deleteObject(key).catch(() => undefined)
        for (const st of await getUploadStates(libraryId)) {
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
      s.inFlight.delete(local.id)
      if (alive()) {
        s.uploadProgress.value = null
        await refreshUsage()
      }
    }
  }

  /** Continues uploads that were interrupted (tab closed, network lost) using the local copies. */
  function resumeUploads(): Promise<void> {
    if (s.resuming) return s.resuming
    const libraryId = s.libraryId.value
    if (!libraryId) return Promise.resolve()
    s.resuming = (async () => {
      for (const p of await getPendingFor(libraryId)) {
        if (s.libraryId.value !== libraryId) return
        const local = await getGame(p.localGameId)
        if (local) await uploadGame(local)
        else await savePendingFor((await getPendingFor(libraryId)).filter((x) => x.localGameId !== p.localGameId), libraryId)
      }
    })().finally(() => {
      s.resuming = null
    })
    return s.resuming
  }

  function noticeFor(err: unknown): LibraryNotice {
    if (err instanceof DecryptError) return { kind: 'error', key: 'cloud.corrupt' }
    if (err instanceof StorageError) return { kind: 'error', key: err.code === 'quota' ? 'errors.quota' : 'errors.unavailable' }
    if (err instanceof ApiError && err.status === 404) return { kind: 'error', key: 'cloud.missingObject' }
    return { kind: 'error', key: 'cloud.network' }
  }

  async function issueShare(payload: SharePayload, gameId: string | null, allowedKeys: string[]): Promise<string> {
    const { api } = requireOpen()
    const secret = newShareSecret()
    const { shareId, kShare } = await deriveShareKeys(secret)
    await api.createShare({ shareId, gameId, allowedKeys, wrapped: await wrapPayload(kShare, payload) })
    await loadIssuedShares()
    return formatShareCode(secret)
  }

  /** Creates a code that lets anyone download this one game. */
  async function shareGame(gameId: string): Promise<string> {
    const game = s.games.value.find((g) => g.id === gameId)
    if (!game) throw new Error('Game not found')
    const keys = game.files.map((f) => f.objectKey)
    if (game.coverObjectKey) keys.push(game.coverObjectKey)
    // Recipients do not need (and should not learn) when the owner last played it.
    return issueShare({ v: 1, kind: 'game', game: { ...structuredClone(toRaw(game)), lastPlayedAt: null } }, game.id, keys)
  }

  /** Creates a code that lets anyone see and play the whole library (read-only). */
  async function shareLibrary(): Promise<string> {
    const { keys } = requireOpen()
    return issueShare({ v: 1, kind: 'library', kLib: toBase64Url(keys.kLibRaw) }, null, [])
  }

  async function loadIssuedShares(): Promise<void> {
    const { api } = requireOpen()
    const rows = await api.listShares()
    s.issuedShares.value = rows
      .filter((r) => r.revokedAt === null)
      .map((r) => ({
        id: r.id,
        kind: r.gameId ? 'game' : 'library',
        gameId: r.gameId,
        createdAt: r.createdAt,
        label: r.gameId ? (s.games.value.find((g) => g.id === r.gameId)?.title ?? 'Deleted game') : 'Whole library',
      }))
  }

  async function revokeShare(id: string): Promise<void> {
    const { api } = requireOpen()
    try {
      await api.revokeShare(id)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        s.notice.value = noticeFor(err)
        return
      }
    }
    s.issuedShares.value = s.issuedShares.value.filter((x) => x.id !== id)
  }

  async function deleteGame(id: string): Promise<void> {
    const { api } = requireOpen()
    const game = s.games.value.find((g) => g.id === id)
    if (!game) return
    s.notice.value = null
    try {
      // Revoke this game's codes first so recipients get "no longer valid", not a broken download.
      const rows = await api.listShares()
      for (const r of rows) if (r.gameId === id && r.revokedAt === null) await api.revokeShare(r.id)
    } catch (err) {
      s.notice.value = noticeFor(err)
      return
    }
    s.issuedShares.value = s.issuedShares.value.filter((x) => x.gameId !== id)
    try {
      // Manifest first: an orphaned object is better than a manifest entry pointing at nothing.
      await saveManifest((m) => {
        m.games = m.games.filter((g) => g.id !== id)
      })
    } catch (err) {
      s.notice.value = noticeFor(err)
      return
    }
    for (const f of game.files) await api.deleteObject(f.objectKey).catch(() => undefined)
    if (game.coverObjectKey) await api.deleteObject(game.coverObjectKey).catch(() => undefined)
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

  /** Downloads and decrypts every file of a cloud game into named Files (in memory). */
  async function downloadGameFiles(game: CloudGame, onProgress?: (done: number, total: number) => void): Promise<File[]> {
    const { api } = requireOpen()
    const kGame = fromBase64Url(game.kGame)
    const out: File[] = []
    let before = 0
    for (const ref of game.files) {
      const bytes = await downloadObject(api, ref, kGame, (d) => onProgress?.(before + d, game.sizeBytes))
      out.push(new File([bytes as BlobPart], ref.name))
      before += ref.size
    }
    return out
  }

  /** Copies a cloud game into this browser's local library so it plays offline. */
  async function downloadToLocal(id: string): Promise<LocalGame | null> {
    const game = s.games.value.find((g) => g.id === id)
    if (!game) return null
    s.notice.value = null
    s.downloadProgress.value = { gameId: id, title: game.title, done: 0, total: game.sizeBytes }
    try {
      const files = await downloadGameFiles(game, (done, total) => {
        s.downloadProgress.value = { gameId: id, title: game.title, done, total }
      })
      const added = await addGame({ title: game.title, kind: game.kind, primaryName: game.primaryName, files, generatedM3u: game.generatedM3u, totalBytes: game.sizeBytes })
      const cover = await coverUrl(game)
      if (cover) {
        await setCover(added.id, await (await fetch(cover)).blob())
        return (await getGame(added.id)) ?? added
      }
      return added
    } catch (err) {
      s.notice.value = noticeFor(err)
      return null
    } finally {
      s.downloadProgress.value = null
    }
  }

  async function renameGame(id: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      await saveManifest((m) => {
        const g = m.games.find((x) => x.id === id)
        if (g) g.title = trimmed
      })
    } catch (err) {
      s.notice.value = noticeFor(err)
    }
  }

  return {
    status: s.status,
    libraryId: s.libraryId,
    games: s.games,
    usage: s.usage,
    notice: s.notice,
    busy: s.busy,
    recoveryKey: s.recoveryKey,
    remembered: s.remembered,
    uploadProgress: s.uploadProgress,
    isInCloud,
    uploadGame,
    resumeUploads,
    deleteGame,
    renameGame,
    coverUrl,
    downloadGameFiles,
    downloadToLocal,
    downloadProgress: s.downloadProgress,
    issuedShares: s.issuedShares,
    shareGame,
    shareLibrary,
    loadIssuedShares,
    revokeShare,
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
