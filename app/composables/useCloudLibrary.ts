import { ref, type Ref } from 'vue'
import type { CloudGame, LibraryManifest, LibraryUsage } from '~~/shared/types/library'
import { fromBase64Url, toBase64Url } from '~~/shared/utils/bytes'
import { decryptJson, encryptJson } from '~~/shared/utils/chunkCrypto'
import { authVerifierHex, deriveLibraryKeys, deriveRootKey, formatRecoveryKey, parseSecret, type LibraryKeys } from '~~/shared/utils/libraryKeys'
import { ApiError, createCloudApi, type CloudApi } from '~/utils/cloudApi'
import type { LibraryNotice } from './useLocalLibrary'

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

  return {
    status: s.status,
    libraryId: s.libraryId,
    games: s.games,
    usage: s.usage,
    notice: s.notice,
    busy: s.busy,
    recoveryKey: s.recoveryKey,
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
