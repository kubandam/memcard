<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ClassifiedGame, LocalGame } from '~~/shared/types/game'
import { sessionGame } from '~/composables/useLocalLibrary'
import { getBlob, getGame, getSetting, touchLastPlayed } from '~/utils/localDb'
import { buildGameFile } from '~/utils/packGame'
import { readKeyboardMapping, type KeyBinding } from '~/utils/emulatorjs'

definePageMeta({ layout: 'boot' })

const route = useRoute()
const { t } = useI18n()
const { public: { emulatorjsBase } } = useRuntimeConfig()
const { theme } = useTheme()

const source = computed(() => String(route.params.source))
const id = computed(() => String(route.params.id))

const { phase, progress, error, setPhase, setSubProgress, fail, start, onSaveExport } = useEmulator()
const title = ref('')
const notFound = ref(false)
const controlsOpen = ref(false)
const mapping = ref<KeyBinding[]>([])

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

useHead({ title: computed(() => title.value || t('player.title')) })

async function readBios(): Promise<File | undefined> {
  const key = await getSetting<string>('bios')
  if (!key) return undefined
  const blob = await getBlob(key)
  if (!blob) return undefined
  const name = (await getSetting<string>('biosName')) ?? 'bios.bin'
  return new File([blob], name)
}

async function loadLocal(game: LocalGame) {
  title.value = game.title
  setPhase('reading')
  const file = await buildGameFile(game, getBlob, (f) => setSubProgress('reading', 'loading', f))
  if (game.kind === 'multi') setPhase('packing')
  const biosFile = await readBios()
  await touchLastPlayed(game.id)
  start({ file, gameName: game.primaryName, base: emulatorjsBase, biosFile, color: theme.value === 'grey' ? '#1f1f1f' : '#f2f2f2' })
}

async function loadSession(game: ClassifiedGame) {
  title.value = game.title
  setPhase('reading')
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
  const file = await buildGameFile(pseudo, async (key) => blobs.get(key))
  const biosFile = await readBios()
  start({ file, gameName: game.primaryName, base: emulatorjsBase, biosFile, color: theme.value === 'grey' ? '#1f1f1f' : '#f2f2f2' })
}

onMounted(async () => {
  try {
    if (source.value === 'local') {
      const game = await getGame(id.value)
      if (!game) return void (notFound.value = true)
      await loadLocal(game)
    } else if (source.value === 'session') {
      const game = sessionGame.value
      if (!game) return void (notFound.value = true)
      await loadSession(game)
    } else {
      // 'free' (M2) and 'cloud' (M3) are not implemented yet.
      notFound.value = true
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
})

function fullscreen() {
  document.getElementById('stage')?.requestFullscreen?.()
}
</script>

<template>
  <div id="stage" class="stage">
    <template v-if="notFound">
      <div class="not-found">
        <h1 class="not-found__title">{{ t('player.notFound') }}</h1>
        <p class="not-found__text">{{ t('player.notFoundHint') }}</p>
        <a href="/" class="not-found__link">{{ t('player.backToLibrary') }}</a>
      </div>
    </template>
    <template v-else>
      <BootStage :title="title" :phase="phase" :progress="progress" :error="error">
        <a v-if="phase === 'error'" href="/" class="not-found__link">{{ t('player.backToLibrary') }}</a>
      </BootStage>
      <div id="game" class="game" />
      <PlayerOverlay v-if="phase === 'running'" @fullscreen="fullscreen" @controls="openControls" />
      <ControlsOverlay :open="controlsOpen" :mapping="mapping" @close="controlsOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.stage {
  position: absolute;
  inset: 0;
  background: #000;
}

.stage:fullscreen {
  background: #000;
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
  background: var(--boot-bg);
}

.not-found__title {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 300;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  font-size: 18px;
  margin: 0;
  text-shadow: 0 0 14px rgba(255, 255, 255, 0.6);
}

.not-found__text {
  margin: 0;
  color: rgba(255, 255, 255, 0.65);
}

.not-found__link {
  color: #fff;
  font-size: 11px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  margin-top: 12px;
}
</style>
