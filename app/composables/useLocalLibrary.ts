import { computed, ref, type Ref } from 'vue'
import type { ClassifiedGame, LocalGame } from '~~/shared/types/game'
import { classifyFiles } from '~/utils/gameFiles'
import { StorageError, addGame, deleteGame, estimateStorage, getBlob, getSetting, listGames, renameGame, requestPersist, setCover, setSetting } from '~/utils/localDb'
import { fetchCoverImage, pickCover } from '~~/shared/utils/coverMatch'

export interface LibraryNotice {
  kind: 'error' | 'info'
  key: string
  params?: Record<string, string>
}

export const LARGE_SINGLE_BYTES = 700 * 1024 * 1024
export const LARGE_MULTI_BYTES = 1.5 * 1024 * 1024 * 1024
/** Above this many bytes of raw disc images we suggest converting to CHD. */
export const CHD_NUDGE_BYTES = 100 * 1024 * 1024

const RAW_IMAGE = /\.(bin|iso|img)$/i

/** Bytes of uncompressed disc images (bin/iso/img) among the files. */
export function uncompressedBytes(files: { name: string; size: number }[]): number {
  return files.filter((f) => RAW_IMAGE.test(f.name)).reduce((n, f) => n + f.size, 0)
}

/**
 * A game that could not be stored (quota) but can still be played this session.
 * Module-level so /play/session/current can read it after a full-page navigation
 * is NOT possible — it survives client-side navigation only, by design.
 */
export const sessionGame: Ref<ClassifiedGame | null> = ref(null)

export function useLocalLibrary() {
  const games = ref<LocalGame[]>([])
  const loading = ref(false)
  const notice = ref<LibraryNotice | null>(null)
  const storage = ref<{ usage: number; quota: number } | null>(null)
  const saving = ref(false)
  /** Object URLs for stored covers, keyed by game id; revoked when the list refreshes. */
  const coverUrls = ref<Record<string, string>>({})
  const coverBusy = ref<string | null>(null)
  let thumbnailIndex: string[] | null = null
  /** null = not decided yet (ask once), true/false = remembered choice. */
  const autoCovers = ref<boolean | null>(null)
  /** Set when a game was added while auto-covers is undecided; resolved by the consent prompt. */
  const pendingConsentFor = ref<LocalGame | null>(null)
  const bulkBusy = ref(false)

  async function loadCovers(list: LocalGame[]) {
    for (const url of Object.values(coverUrls.value)) URL.revokeObjectURL(url)
    const next: Record<string, string> = {}
    for (const game of list) {
      if (!game.coverBlobKey) continue
      const blob = await getBlob(game.coverBlobKey)
      if (blob) next[game.id] = URL.createObjectURL(blob)
    }
    coverUrls.value = next
  }

  async function refresh() {
    loading.value = true
    try {
      games.value = await listGames()
      await loadCovers(games.value)
      storage.value = await estimateStorage()
      if (autoCovers.value === null) autoCovers.value = (await getSetting<boolean>('autoCovers')) ?? null
    } catch (err) {
      notice.value = { kind: 'error', key: err instanceof StorageError && err.code === 'quota' ? 'errors.quota' : 'errors.unavailable' }
    } finally {
      loading.value = false
    }
  }

  async function addFiles(files: File[]): Promise<LocalGame | null> {
    notice.value = null
    const result = await classifyFiles(files)
    if (!result.ok) {
      notice.value = { kind: 'error', key: `errors.${result.error.code}`, params: { details: result.error.details.join(', ') } }
      return null
    }
    const { game } = result
    const limit = game.kind === 'single' ? LARGE_SINGLE_BYTES : LARGE_MULTI_BYTES
    // Warn before the (possibly long) save so the user sees it while waiting.
    if (game.totalBytes > limit) notice.value = { kind: 'info', key: 'warnings.largeFile' }
    else if (uncompressedBytes(game.files) > CHD_NUDGE_BYTES) notice.value = { kind: 'info', key: 'warnings.chdNudge' }
    saving.value = true
    try {
      if (games.value.length === 0) await requestPersist()
      const stored = await addGame(game)
      await refresh()
      if (autoCovers.value === true) void findCoverOnline(stored, { quiet: true })
      else if (autoCovers.value === null) pendingConsentFor.value = stored
      return stored
    } catch (err) {
      if (err instanceof StorageError) {
        sessionGame.value = game
        notice.value = { kind: 'error', key: err.code === 'quota' ? 'errors.quota' : 'errors.unavailable' }
        return null
      }
      throw err
    } finally {
      saving.value = false
    }
  }

  async function rename(id: string, title: string) {
    try {
      await renameGame(id, title)
    } catch (err) {
      if (err instanceof RangeError) {
        notice.value = { kind: 'error', key: 'errors.emptyTitle' }
        return
      }
      throw err
    }
    await refresh()
  }

  async function remove(id: string) {
    await deleteGame(id)
    await refresh()
  }

  async function setCoverFromFile(id: string, image: File) {
    notice.value = null
    if (!image.type.startsWith('image/')) {
      notice.value = { kind: 'error', key: 'errors.notAnImage' }
      return
    }
    try {
      await setCover(id, image)
      await refresh()
    } catch (err) {
      if (err instanceof StorageError) notice.value = { kind: 'error', key: err.code === 'quota' ? 'errors.quota' : 'errors.unavailable' }
      else throw err
    }
  }

  /**
   * Explicit, per-game online lookup. The index of names is fetched from our own server and matched
   * locally; only when a match exists is that one image URL requested from libretro-thumbnails
   * (which therefore learns the title). Never runs without the user's click.
   */
  async function decideAutoCovers(enabled: boolean) {
    autoCovers.value = enabled
    await setSetting('autoCovers', enabled).catch(() => undefined)
    const pending = pendingConsentFor.value
    pendingConsentFor.value = null
    if (enabled && pending) await findCoverOnline(pending, { quiet: true })
  }

  /** Fetches covers for every game that has none. Sequential to be gentle on the thumbnail host. */
  async function findMissingCovers() {
    bulkBusy.value = true
    try {
      for (const game of games.value.filter((g) => !g.coverBlobKey)) await findCoverOnline(game, { quiet: true })
    } finally {
      bulkBusy.value = false
    }
  }

  async function findCoverOnline(game: LocalGame, opts: { quiet?: boolean } = {}) {
    if (!opts.quiet) notice.value = null
    coverBusy.value = game.id
    try {
      if (!thumbnailIndex) {
        const res = await fetch('/api/covers')
        if (!res.ok) throw new Error('index')
        thumbnailIndex = ((await res.json()) as { names: string[] }).names
      }
      const name = pickCover(game.primaryName, thumbnailIndex) ?? pickCover(game.title, thumbnailIndex)
      if (!name) {
        if (!opts.quiet) notice.value = { kind: 'info', key: 'covers.notFound', params: { title: game.title } }
        return
      }
      const image = await fetchCoverImage(name)
      if (!image) throw new Error('image')
      await setCover(game.id, image)
      await refresh()
    } catch (err) {
      if (err instanceof StorageError) notice.value = { kind: 'error', key: err.code === 'quota' ? 'errors.quota' : 'errors.unavailable' }
      else if (!opts.quiet) notice.value = { kind: 'error', key: 'covers.failed' }
    } finally {
      coverBusy.value = null
    }
  }

  const missingCoverCount = computed(() => games.value.filter((g) => !g.coverBlobKey).length)

  return {
    games, loading, saving, notice, storage, sessionGame, coverUrls, coverBusy, bulkBusy, autoCovers, pendingConsentFor, missingCoverCount,
    refresh, addFiles, rename, remove, setCoverFromFile, findCoverOnline, findMissingCovers, decideAutoCovers,
  }
}
