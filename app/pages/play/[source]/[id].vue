<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { ClassifiedGame, LocalGame } from '~~/shared/types/game'
import { sessionGame } from '~/composables/useLocalLibrary'
import { readKeyboardMapping, type KeyBinding } from '~/utils/emulatorjs'
import { buildGamePayload, type BlobGetter } from '~/utils/gamePayload'
import { getBlob, getGame, getSetting, touchLastPlayed } from '~/utils/localDb'
import { ApiError } from '~/utils/cloudApi'
import { DecryptError } from '~/utils/cloudDownload'
import { SharedGameGoneError, ShareRevokedError } from '~/composables/useSharedLibraries'
import { createSaveSync, type CardFs } from '~/utils/saveSyncClient'
import { fromBase64Url } from '~~/shared/utils/bytes'
import type { SyncMeta } from '~~/shared/utils/saveSync'
import { setSetting } from '~/utils/localDb'

definePageMeta({ layout: 'boot' })

const route = useRoute()
const { t } = useI18n()
const { public: { emulatorjsBase } } = useRuntimeConfig()

const source = computed(() => String(route.params.source))
const id = computed(() => String(route.params.id))

const { phase, progress, error, setPhase, setSubProgress, fail, start, onSaveExport, flushSaves } = useEmulator()
const title = ref('')
const notFound = ref(false)
const libraryClosed = ref(false)
const controlsOpen = ref(false)
const mapping = ref<KeyBinding[]>([])
const saveSync = shallowRef<ReturnType<typeof createSaveSync> | null>(null)
const saveNotice = ref<string | null>(null)

interface BootHooks {
  onFsReady?: (fs: unknown, path: string) => void
  onCardSaved?: (card: Uint8Array) => void
}

function downloadCard(card: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([card as BlobPart], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

useHead({ title: computed(() => title.value || t('player.title')) })

onSaveExport((save) => {
  const url = URL.createObjectURL(new Blob([save as BlobPart], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.value || 'memcard'}.srm`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})

function openControls() {
  mapping.value = readKeyboardMapping((window as unknown as { EJS_emulator?: unknown }).EJS_emulator)
  controlsOpen.value = true
}

/** The optional BIOS from settings; storage trouble must not stop the game, so errors are swallowed. */
async function readBiosBytes(): Promise<Uint8Array | undefined> {
  try {
    const key = await getSetting<string>('bios')
    if (!key) return undefined
    const blob = await getBlob(key)
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
  } catch {
    return undefined
  }
}

function ejsColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ejs-color').trim()
  return value || '#f2f2f2'
}

async function boot(game: LocalGame, getter: BlobGetter, hooks: BootHooks = {}) {
  title.value = game.title
  if (phase.value !== 'reading') setPhase('reading')
  if (game.kind === 'multi') setPhase('packing')
  const payload = await buildGamePayload(game, getter, (f) => setSubProgress(game.kind === 'multi' ? 'packing' : 'reading', 'loading', f))
  const bios = await readBiosBytes()
  start({ file: payload.file, extraFiles: payload.extraFiles, bios, gameName: game.primaryName, base: emulatorjsBase, color: ejsColor(), ...hooks })
}

async function loadLocal(game: LocalGame) {
  await touchLastPlayed(game.id).catch(() => undefined)
  await boot(game, getBlob)
}

async function loadCloud(gameId: string) {
  const cloud = useCloudLibrary()
  await cloud.restore()
  if (cloud.status.value !== 'open') return void (libraryClosed.value = true)
  const game = cloud.games.value.find((g) => g.id === gameId)
  if (!game) return void (notFound.value = true)
  title.value = game.title
  setPhase('reading')
  const files = await cloud.downloadGameFiles(game, (done, total) => setSubProgress('reading', 'loading', done / Math.max(1, total)))
  const byName = new Map(files.map((f) => [f.name, f]))
  const pseudo: LocalGame = {
    id: game.id,
    title: game.title,
    source: 'cloud',
    kind: game.kind,
    primaryName: game.primaryName,
    files: game.files.map((f) => ({ name: f.name, size: f.size, blobKey: f.name })),
    generatedM3u: game.generatedM3u,
    sizeBytes: game.sizeBytes,
    createdAt: game.createdAt,
    lastPlayedAt: game.lastPlayedAt,
  }
  // Memory-card sync: fetch the cloud card before boot, inject it in the FS hook, push changes while playing.
  let kGame: Uint8Array
  try {
    kGame = fromBase64Url(game.kGame)
  } catch {
    // Without a usable game key there is nothing to sync; play anyway.
    return boot(pseudo, async (key) => byName.get(key))
  }
  const sync = createSaveSync({
    api: cloud.saveApi(),
    kGame,
    getMeta: async (k) => (await getSetting<SyncMeta>(`saveSync.${k}`)) ?? null,
    setMeta: (k, m) => setSetting(`saveSync.${k}`, m),
  })
  await sync.prepare().catch(() => undefined)
  saveSync.value = sync
  await boot(pseudo, async (key) => byName.get(key), {
    onFsReady: (fs, path) => {
      const res = sync.onFsReady(fs as CardFs, path)
      if (res.action === 'conflict' && res.keepLocal) {
        downloadCard(res.keepLocal, `${game.title} (this PC, ${new Date().toISOString().slice(0, 10)}).srm`)
        saveNotice.value = t('save.conflict')
      } else if (res.action === 'pull') {
        saveNotice.value = t('save.pulled')
      }
    },
    onCardSaved: (card) => sync.onCardSaved(card),
  })
}

async function loadShared(gameId: string, shareId: string) {
  const shared = useSharedLibraries()
  await shared.restoreOne(shareId)
  const lib = shared.libraries.value.find((l) => l.shareId === shareId)
  if (!lib) return void (notFound.value = true)
  if (lib.status === 'revoked') throw new ShareRevokedError()
  if (lib.status === 'error') throw new ApiError(503)
  const game = lib.games.find((g) => g.id === gameId)
  if (!game) return void (notFound.value = true)
  title.value = game.title
  setPhase('reading')
  const files = await shared.downloadGameFiles(shareId, game, (done, total) => setSubProgress('reading', 'loading', done / Math.max(1, total)), lib.libraryId)
  const byName = new Map(files.map((f) => [f.name, f]))
  await boot(
    {
      id: game.id,
      title: game.title,
      source: 'cloud',
      kind: game.kind,
      primaryName: game.primaryName,
      files: game.files.map((f) => ({ name: f.name, size: f.size, blobKey: f.name })),
      generatedM3u: game.generatedM3u,
      sizeBytes: game.sizeBytes,
      createdAt: game.createdAt,
      lastPlayedAt: game.lastPlayedAt,
    },
    async (key) => byName.get(key),
  )
}

async function loadSession(game: ClassifiedGame) {
  const blobs = new Map(game.files.map((f) => [f.name, f]))
  const pseudo: LocalGame = {
    id: 'session',
    title: game.title,
    source: 'local',
    kind: game.kind,
    primaryName: game.primaryName,
    files: game.files.map((f) => ({ name: f.name, size: f.size, blobKey: f.name })),
    generatedM3u: game.generatedM3u,
    sizeBytes: game.totalBytes,
    createdAt: Date.now(),
    lastPlayedAt: null,
  }
  await boot(pseudo, async (key) => blobs.get(key))
}

onMounted(async () => {
  window.addEventListener('pagehide', flushSaves)
  document.addEventListener('visibilitychange', onVisibility)
  try {
    if (source.value === 'local') {
      const game = await getGame(id.value)
      if (!game) return void (notFound.value = true)
      await loadLocal(game)
    } else if (source.value === 'session') {
      const game = sessionGame.value
      if (!game) return void (notFound.value = true)
      await loadSession(game)
    } else if (source.value === 'cloud') {
      await loadCloud(id.value)
    } else if (source.value === 'shared') {
      await loadShared(id.value, String(route.query.share ?? ''))
    } else {
      // 'free' (M2) is not implemented yet.
      notFound.value = true
    }
  } catch (err) {
    if (err instanceof ShareRevokedError) fail(t('share.invalid'))
    else if (err instanceof SharedGameGoneError) fail(t('share.gameGone'))
    else if (err instanceof DecryptError) fail(t('cloud.corrupt'))
    else if (err instanceof ApiError && err.status === 404) fail(t('cloud.missingObject'))
    else if (err instanceof ApiError) fail(t('cloud.network'))
    else fail(err instanceof Error ? err.message : String(err))
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flushSaves)
  document.removeEventListener('visibilitychange', onVisibility)
})

function onVisibility() {
  if (document.visibilityState === 'hidden') flushSaves()
}

/** EmulatorJS has no teardown: every exit from this page is a full navigation, Back button included. */
onBeforeRouteLeave((to) => {
  flushSaves()
  window.location.assign(to.fullPath)
  return false
})

function leave() {
  flushSaves()
  window.location.assign('/')
}

function fullscreen() {
  document.getElementById('stage')?.requestFullscreen?.()
}
</script>

<template>
  <div id="stage" class="stage" :class="{ 'stage--running': phase === 'running' }">
    <template v-if="libraryClosed">
      <div class="not-found">
        <h1 class="not-found__title">{{ t('cloud.closedTitle') }}</h1>
        <p class="not-found__text">{{ t('cloud.closedHint') }}</p>
        <a href="/" class="exit-link">{{ t('player.backToLibrary') }}</a>
      </div>
    </template>
    <template v-else-if="notFound">
      <div class="not-found">
        <h1 class="not-found__title">{{ t('player.notFound') }}</h1>
        <p class="not-found__text">{{ t('player.notFoundHint') }}</p>
        <a href="/" class="exit-link">{{ t('player.backToLibrary') }}</a>
      </div>
    </template>
    <template v-else>
      <BootStage :title="title" :phase="phase" :progress="progress" :error="error">
        <a href="/" class="exit-link" @click.prevent="leave">{{ t('player.backToLibrary') }}</a>
      </BootStage>
      <div id="game" class="game" />
      <PlayerOverlay
        v-if="phase === 'running'"
        :save-status="saveSync?.status.value ?? null"
        :saved-at="saveSync?.lastSyncedAt.value ?? null"
        :save-notice="saveNotice"
        @fullscreen="fullscreen"
        @controls="openControls"
        @leave="leave"
      />
      <ControlsOverlay :open="controlsOpen" :mapping="mapping" @close="controlsOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.stage {
  position: absolute;
  inset: 0;
}

.stage--running,
.stage:fullscreen {
  background: var(--boot-canvas-bg);
}

.game {
  position: absolute;
  inset: 0;
}

.not-found {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 12px;
  padding: 24px;
}

.not-found__title {
  font-family: var(--boot-font);
  font-weight: 300;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  font-size: 18px;
  margin: 0;
  color: var(--boot-fg);
  text-shadow: 0 0 14px var(--boot-glow);
}

.not-found__text {
  margin: 0;
  color: var(--boot-fg-muted);
}

.exit-link {
  display: inline-block;
  margin-top: 16px;
  color: var(--boot-fg);
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: 11px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  text-decoration: none;
  border: 1px solid var(--boot-line);
  border-radius: 999px;
  padding: 10px 16px;
  min-height: 44px;
}
</style>
