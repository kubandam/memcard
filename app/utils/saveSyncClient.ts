import { ref, type Ref } from 'vue'
import { decideOnStart, deriveSaveKeys, fingerprint, openSave, sealSave, type CloudSave, type SyncMeta } from '~~/shared/utils/saveSync'
import { ApiError } from './cloudApi'

export interface SaveApi {
  getSave(saveKey: string): Promise<Uint8Array | null>
  putSave(saveKey: string, bytes: Uint8Array): Promise<void>
}

/** The bits of the Emscripten FS the sync needs. */
export interface CardFs {
  analyzePath(path: string): { exists: boolean }
  readFile(path: string): Uint8Array
  writeFile(path: string, data: Uint8Array): void
  mkdir(path: string): void
}

export type SaveSyncStatus = 'idle' | 'synced' | 'offline' | 'error'

export interface StartResult {
  action: 'none' | 'push' | 'pull' | 'conflict'
  keepLocal?: Uint8Array
}

export function createSaveSync(opts: {
  api: SaveApi
  kGame: Uint8Array
  getMeta: (saveKey: string) => Promise<SyncMeta | null>
  setMeta: (saveKey: string, meta: SyncMeta) => Promise<void>
  now?: () => number
}) {
  const now = opts.now ?? Date.now
  const status: Ref<SaveSyncStatus> = ref('idle')
  const lastSyncedAt: Ref<number | null> = ref(null)
  let keys: { saveKey: string; key: CryptoKey } | null = null
  let cloud: CloudSave | null = null
  let meta: SyncMeta | null = null
  let lastPushedHash: string | null = null
  let pending: Uint8Array | null = null
  let inFlight = false
  /** False when the cloud card could not be fetched: never push blindly over a card we have not seen. */
  let cloudKnown = true

  function markSynced(m: SyncMeta) {
    meta = m
    lastPushedHash = m.hash
    lastSyncedAt.value = m.updatedAt
    status.value = 'synced'
    void opts.setMeta(keys!.saveKey, m).catch(() => undefined)
  }

  /** Fetches the cloud card and this browser's sync record. Never throws: problems only change `status`. */
  async function prepare(): Promise<void> {
    try {
      keys = await deriveSaveKeys(opts.kGame)
    } catch {
      // Without keys there is no sync; the game still plays with its local card.
      keys = null
      status.value = 'error'
      return
    }
    meta = await opts.getMeta(keys.saveKey).catch(() => null)
    lastPushedHash = meta?.hash ?? null
    let bytes: Uint8Array | null = null
    try {
      bytes = await opts.api.getSave(keys.saveKey)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        status.value = 'offline'
        cloudKnown = false
      }
      return
    }
    if (!bytes) return
    try {
      cloud = await openSave(keys.key, keys.saveKey, bytes)
    } catch {
      // Damaged or foreign: ignore it and keep playing with the local card.
      cloud = null
      status.value = 'error'
    }
  }

  function ensureDir(fs: CardFs, path: string) {
    const parts = path.split('/').slice(1, -1)
    let cur = ''
    for (const p of parts) {
      cur += `/${p}`
      if (!fs.analyzePath(cur).exists) fs.mkdir(cur)
    }
  }

  /** Runs synchronously inside EmulatorJS's `saveDatabaseLoaded` hook, before the core reads the card. */
  function onFsReady(fs: CardFs, path: string): StartResult {
    if (!keys || !cloudKnown) return { action: 'none' }
    const local = fs.analyzePath(path).exists ? fs.readFile(path) : null
    const d = decideOnStart({ local, meta, cloud })
    if ((d.action === 'pull' || d.action === 'conflict') && d.inject) {
      ensureDir(fs, path)
      fs.writeFile(path, d.inject)
    }
    if (cloud && d.action !== 'push') markSynced({ updatedAt: cloud.updatedAt, hash: cloud.hash })
    if (d.action === 'push' && local) onCardSaved(local)
    return d.action === 'conflict' ? { action: 'conflict', keepLocal: d.keepLocal } : { action: d.action }
  }

  async function drain() {
    if (inFlight || !keys) return
    inFlight = true
    try {
      while (pending) {
        const card = pending
        pending = null
        const hash = fingerprint(card)
        if (hash === lastPushedHash) continue
        const updatedAt = now()
        try {
          await opts.api.putSave(keys.saveKey, await sealSave(keys.key, keys.saveKey, card, updatedAt))
          markSynced({ updatedAt, hash })
        } catch {
          status.value = 'offline'
          return
        }
      }
    } finally {
      inFlight = false
    }
  }

  /** Called with every flushed card; uploads only changes, one request at a time, latest wins. */
  function onCardSaved(card: Uint8Array) {
    if (!cloudKnown) return
    pending = card.slice()
    void drain()
  }

  return { prepare, onFsReady, onCardSaved, status, lastSyncedAt }
}
