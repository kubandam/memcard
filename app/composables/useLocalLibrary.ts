import { ref, type Ref } from 'vue'
import type { ClassifiedGame, LocalGame } from '~~/shared/types/game'
import { classifyFiles } from '~/utils/gameFiles'
import { StorageError, addGame, deleteGame, estimateStorage, listGames, renameGame, requestPersist } from '~/utils/localDb'

export interface LibraryNotice {
  kind: 'error' | 'info'
  key: string
  params?: Record<string, string>
}

export const LARGE_SINGLE_BYTES = 700 * 1024 * 1024
export const LARGE_MULTI_BYTES = 1.5 * 1024 * 1024 * 1024

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

  async function refresh() {
    loading.value = true
    try {
      games.value = await listGames()
      storage.value = await estimateStorage()
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
    saving.value = true
    try {
      if (games.value.length === 0) await requestPersist()
      const stored = await addGame(game)
      await refresh()
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

  return { games, loading, saving, notice, storage, sessionGame, refresh, addFiles, rename, remove }
}
