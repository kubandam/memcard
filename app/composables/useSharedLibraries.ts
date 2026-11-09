import { ref, type Ref } from 'vue'
import type { LocalGame } from '~~/shared/types/game'
import type { CloudGame, LibraryManifest } from '~~/shared/types/library'
import { fromBase64Url } from '~~/shared/utils/bytes'
import { decryptJson } from '~~/shared/utils/chunkCrypto'
import { deriveShareKeys, formatShareCode, parseShareCode, unwrapPayload } from '~~/shared/utils/shareCodes'
import { validateCloudGame } from '~~/shared/utils/validateGame'
import { ApiError, createShareReader, lookupShare, type ShareLookup, type ShareReader } from '~/utils/cloudApi'
import { DecryptError, downloadObject } from '~/utils/cloudDownload'
import { addGame, getSetting, setCover, setSetting } from '~/utils/localDb'

/** The share code no longer works (revoked by the owner, or the game was deleted). */
export class ShareRevokedError extends Error {
  constructor() {
    super('This code is no longer valid')
    this.name = 'ShareRevokedError'
  }
}

/** The code still works, but the owner removed this game from the library. */
export class SharedGameGoneError extends Error {
  constructor() {
    super('This game is no longer in the shared library')
    this.name = 'SharedGameGoneError'
  }
}

interface ShareTransport {
  lookup: (shareId: string) => Promise<ShareLookup>
  reader: (shareId: string, libraryId: string) => ShareReader
}

let transport: ShareTransport = {
  lookup: (id) => lookupShare(id),
  reader: (shareId, libraryId) => createShareReader({ shareId, libraryId }),
}

/** Test seam: replace the HTTP transport. */
export function __setShareTransport(t: ShareTransport) {
  transport = t
}

const SAVED_KEY = 'sharedLibraries'

interface SavedLibrary {
  code: string
  shareId: string
  libraryId: string
  addedAt: number
}

export interface SharedLibrary {
  shareId: string
  code: string
  libraryId: string
  games: CloudGame[]
  status: 'ok' | 'revoked' | 'error'
}

export type RedeemResult =
  | { kind: 'game'; game: CloudGame; code: string; shareId: string; libraryId: string }
  | { kind: 'library'; libraryId: string; shareId: string }
  | { error: 'format' | 'invalid' | 'rate' | 'network' }

interface SharedState {
  libraries: Ref<SharedLibrary[]>
  progress: Ref<{ key: string; done: number; total: number } | null>
}

let state: SharedState | null = null

/** Test seam: forget the module-level singleton. */
export function __resetSharedForTests() {
  state = null
}

async function readSaved(): Promise<SavedLibrary[]> {
  try {
    return (await getSetting<SavedLibrary[]>(SAVED_KEY)) ?? []
  } catch {
    return []
  }
}

async function writeSaved(list: SavedLibrary[]): Promise<void> {
  await setSetting(SAVED_KEY, structuredClone(list)).catch(() => undefined)
}

function errorKind(err: unknown): 'invalid' | 'rate' | 'network' {
  if (err instanceof ApiError && err.status === 404) return 'invalid'
  if (err instanceof ApiError && err.status === 429) return 'rate'
  return 'network'
}

export function useSharedLibraries() {
  const s = (state ??= { libraries: ref([]), progress: ref(null) })

  /** Fetches and decrypts a library's manifest through a share; never writes anything. */
  async function loadLibrary(saved: SavedLibrary): Promise<SharedLibrary> {
    const base: SharedLibrary = { shareId: saved.shareId, code: saved.code, libraryId: saved.libraryId, games: [], status: 'ok' }
    try {
      const secret = parseShareCode(saved.code)
      if (!secret) return { ...base, status: 'error' }
      const { shareId, kShare } = await deriveShareKeys(secret)
      const info = await transport.lookup(shareId)
      const payload = await unwrapPayload(kShare, info.wrapped)
      if (payload.kind !== 'library') return { ...base, status: 'error' }
      const kLib = await crypto.subtle.importKey('raw', fromBase64Url(payload.kLib) as BufferSource, 'AES-GCM', false, ['decrypt'])
      const manifest = await transport.reader(shareId, info.libraryId).getManifest()
      // Someone else's manifest: drop any game whose names would be unsafe in the emulator FS.
      const games = manifest ? ((await decryptJson<LibraryManifest>(kLib, manifest.bytes)).games ?? []).filter(validateCloudGame) : []
      return { ...base, libraryId: info.libraryId, games }
    } catch (err) {
      return { ...base, status: errorKind(err) === 'invalid' ? 'revoked' : 'error' }
    }
  }

  async function redeem(input: string): Promise<RedeemResult> {
    const secret = parseShareCode(input)
    if (!secret) return { error: 'format' }
    const code = formatShareCode(secret)
    const { shareId, kShare } = await deriveShareKeys(secret)
    let info: ShareLookup
    try {
      info = await transport.lookup(shareId)
    } catch (err) {
      return { error: errorKind(err) }
    }
    let payload
    try {
      payload = await unwrapPayload(kShare, info.wrapped)
    } catch {
      return { error: 'invalid' }
    }
    if (payload.kind === 'game') return { kind: 'game', game: payload.game, code, shareId, libraryId: info.libraryId }

    const saved = (await readSaved()).filter((x) => x.shareId !== shareId)
    const entry: SavedLibrary = { code, shareId, libraryId: info.libraryId, addedAt: Date.now() }
    saved.push(entry)
    await writeSaved(saved)
    const lib = await loadLibrary(entry)
    s.libraries.value = [...s.libraries.value.filter((x) => x.shareId !== shareId), lib]
    return { kind: 'library', libraryId: info.libraryId, shareId }
  }

  /** Replaces or adds loaded entries without dropping ones that appeared meanwhile (e.g. a fresh redeem). */
  function merge(loaded: SharedLibrary[]) {
    const byId = new Map(s.libraries.value.map((l) => [l.shareId, l]))
    for (const l of loaded) byId.set(l.shareId, l)
    s.libraries.value = [...byId.values()]
  }

  async function restore(): Promise<void> {
    const saved = await readSaved()
    merge(await Promise.all(saved.map(loadLibrary)))
  }

  /** Loads just one saved library (the player only needs the one in ?share). */
  async function restoreOne(shareId: string): Promise<void> {
    const saved = (await readSaved()).find((x) => x.shareId === shareId)
    if (saved) merge([await loadLibrary(saved)])
  }

  const covers = new Map<string, string>()

  /** Decrypts a shared game's cover into an object URL; undefined when there is none or it fails. */
  async function coverUrl(shareId: string, game: CloudGame): Promise<string | undefined> {
    if (!game.coverObjectKey || !game.coverSize) return undefined
    const cacheKey = `${shareId}:${game.coverObjectKey}`
    const hit = covers.get(cacheKey)
    if (hit) return hit
    try {
      const reader = transport.reader(shareId, libraryIdFor(shareId))
      const bytes = await downloadObject(reader, { name: 'cover', size: game.coverSize, objectKey: game.coverObjectKey, chunks: Math.ceil(game.coverSize / (4 * 1024 * 1024)) }, fromBase64Url(game.kGame))
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
      covers.set(cacheKey, url)
      return url
    } catch {
      return undefined
    }
  }

  async function remove(shareId: string): Promise<void> {
    await writeSaved((await readSaved()).filter((x) => x.shareId !== shareId))
    s.libraries.value = s.libraries.value.filter((x) => x.shareId !== shareId)
  }

  function libraryIdFor(shareId: string, fallback?: string): string {
    const id = s.libraries.value.find((l) => l.shareId === shareId)?.libraryId ?? fallback
    if (!id) throw new ShareRevokedError()
    return id
  }

  /** Downloads and decrypts every file of a shared game into memory. */
  async function downloadGameFiles(shareId: string, game: CloudGame, onProgress?: (done: number, total: number) => void, libraryId?: string): Promise<File[]> {
    const reader = transport.reader(shareId, libraryIdFor(shareId, libraryId))
    const kGame = fromBase64Url(game.kGame)
    const out: File[] = []
    let before = 0
    try {
      for (const ref of game.files) {
        const bytes = await downloadObject(reader, ref, kGame, (d) => onProgress?.(before + d, game.sizeBytes))
        out.push(new File([bytes as BlobPart], ref.name))
        before += ref.size
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Either the code was revoked, or only this game was removed: ask the server which.
        let stillValid = false
        try {
          await transport.lookup(shareId)
          stillValid = true
        } catch {
          stillValid = false
        }
        const saved = (await readSaved()).find((x) => x.shareId === shareId)
        if (stillValid && saved) {
          const fresh = await loadLibrary(saved)
          s.libraries.value = s.libraries.value.map((l) => (l.shareId === shareId ? fresh : l))
          throw new SharedGameGoneError()
        }
        if (stillValid) throw new SharedGameGoneError()
        s.libraries.value = s.libraries.value.map((l) => (l.shareId === shareId ? { ...l, status: 'revoked' } : l))
        throw new ShareRevokedError()
      }
      throw err
    }
    return out
  }

  /** Copies a shared game (from a game code or a shared library) into My games. */
  async function downloadToLocal(source: { shareId: string; game: CloudGame; libraryId?: string }): Promise<LocalGame | null> {
    const { shareId, game } = source
    s.progress.value = { key: `${shareId}:${game.id}`, done: 0, total: game.sizeBytes }
    try {
      const files = await downloadGameFiles(shareId, game, (done, total) => (s.progress.value = { key: `${shareId}:${game.id}`, done, total }), source.libraryId)
      const added = await addGame({ title: game.title, kind: game.kind, primaryName: game.primaryName, files, generatedM3u: game.generatedM3u, totalBytes: game.sizeBytes })
      if (game.coverObjectKey && game.coverSize) {
        try {
          const reader = transport.reader(shareId, libraryIdFor(shareId, source.libraryId))
          const cover = await downloadObject(reader, { name: 'cover', size: game.coverSize, objectKey: game.coverObjectKey, chunks: Math.ceil(game.coverSize / (4 * 1024 * 1024)) }, fromBase64Url(game.kGame))
          await setCover(added.id, new Blob([cover as BlobPart]))
        } catch {
          // The game itself is in; a missing cover is not worth failing over.
        }
      }
      return added
    } catch (err) {
      if (err instanceof ShareRevokedError || err instanceof DecryptError) throw err
      throw err
    } finally {
      s.progress.value = null
    }
  }

  return { libraries: s.libraries, progress: s.progress, redeem, restore, restoreOne, remove, coverUrl, downloadGameFiles, downloadToLocal }
}
