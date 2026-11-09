<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { LocalGame } from '~~/shared/types/game'
import { formatBytes } from '~/utils/format'
import { listGames } from '~/utils/localDb'

const { t } = useI18n()
const { remembered, games, usage, uploadProgress, downloadProgress, notice, recoveryKey, close, uploadGame, deleteGame, renameGame, resumeUploads, coverUrl, isInCloud, downloadToLocal, shareGame, shareLibrary } = useCloudLibrary()
const emit = defineEmits<{ downloaded: [] }>()

const pickerOpen = ref(false)
const candidates = ref<LocalGame[]>([])
const covers = ref<Record<string, string>>({})
const renaming = ref<string | null>(null)
const renameValue = ref('')
const confirmingDelete = ref<string | null>(null)
const localGames = ref<LocalGame[]>([])
const shareResult = ref<{ code: string; note: string } | null>(null)
const sharing = ref(false)
const shareError = ref<string | null>(null)

function shareErrorKey(err: unknown): string {
  return (err as { status?: number })?.status === 429 ? 'share.tooManyCodes' : 'cloud.network'
}

async function onShareGame(id: string) {
  sharing.value = true
  shareError.value = null
  try {
    shareResult.value = { code: await shareGame(id), note: t('share.gameNote') }
  } catch (err) {
    shareResult.value = null
    shareError.value = shareErrorKey(err)
  } finally {
    sharing.value = false
  }
}

async function onShareLibrary() {
  sharing.value = true
  shareError.value = null
  try {
    shareResult.value = { code: await shareLibrary(), note: t('share.libraryNote') }
  } catch (err) {
    shareResult.value = null
    shareError.value = shareErrorKey(err)
  } finally {
    sharing.value = false
  }
}

async function loadLocal() {
  localGames.value = await listGames()
}

function isLocal(game: { title: string; sizeBytes: number }) {
  return localGames.value.some((l) => l.title === game.title && l.sizeBytes === game.sizeBytes)
}

async function download(id: string) {
  await downloadToLocal(id)
  await loadLocal()
  emit('downloaded')
}

async function loadCovers() {
  for (const g of games.value) {
    if (covers.value[g.id]) continue
    const url = await coverUrl(g)
    if (url) covers.value = { ...covers.value, [g.id]: url }
  }
}

watch(games, loadCovers)

onMounted(() => {
  loadCovers()
  loadLocal()
  resumeUploads()
})

async function openPicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value) candidates.value = (await listGames()).filter((g) => !isInCloud(g))
}

async function upload(game: LocalGame) {
  pickerOpen.value = false
  await uploadGame(game)
}

async function commitRename() {
  if (renaming.value) await renameGame(renaming.value, renameValue.value)
  renaming.value = null
}

async function onDelete(id: string) {
  if (confirmingDelete.value !== id) {
    confirmingDelete.value = id
    return
  }
  confirmingDelete.value = null
  await deleteGame(id)
}
</script>

<template>
  <div class="cloud-library">
    <RecoveryKeyBox v-if="recoveryKey" :recovery-key="recoveryKey" @done="recoveryKey = null" />

    <div class="cloud-library__bar">
      <div class="cloud-library__usage">
        <StorageMeter v-if="usage" :usage="usage.bytesUsed" :quota="usage.softLimit" />
        <span class="label">{{ t('cloud.gamesCount', { n: games.length }) }}</span>
        <span v-if="remembered" class="label" :title="t('cloud.rememberedHint')">{{ t('cloud.rememberedBadge') }}</span>
      </div>
      <div class="cloud-library__actions">
        <button type="button" data-open-upload class="pill" :disabled="!!uploadProgress" @click="openPicker">{{ t('cloud.upload') }}</button>
        <button type="button" data-share-library class="pill pill--ghost" :disabled="sharing" @click="onShareLibrary">{{ t('share.shareLibrary') }}</button>
        <button type="button" data-close class="link-button label" @click="close">{{ t('cloud.close') }}</button>
      </div>
    </div>

    <Notice v-if="notice" :kind="notice.kind">{{ t(notice.key) }}</Notice>
    <Notice v-if="shareError" kind="error">{{ t(shareError) }}</Notice>
    <ShareCodeBox v-if="shareResult" :code="shareResult.code" :note="shareResult.note" @close="shareResult = null" />
    <IssuedShares />

    <div v-if="uploadProgress" class="cloud-library__progress" role="status">
      <span class="label">{{ t('cloud.uploading', { title: uploadProgress.title }) }} · {{ formatBytes(uploadProgress.done) }} / {{ formatBytes(uploadProgress.total) }}</span>
      <div class="cloud-library__bar-track"><i :style="{ width: `${(uploadProgress.done / Math.max(1, uploadProgress.total)) * 100}%` }" /></div>
    </div>

    <div v-if="pickerOpen" class="cloud-library__picker">
      <p class="label">{{ t('cloud.pickTitle') }}</p>
      <p v-if="!candidates.length" class="cloud-library__empty">{{ t('cloud.pickEmpty') }}</p>
      <button v-for="g in candidates" :key="g.id" type="button" data-upload-candidate class="cloud-library__candidate" @click="upload(g)">
        <span>{{ g.title }}</span>
        <span class="label">{{ formatBytes(g.sizeBytes) }}</span>
      </button>
      <p class="cloud-library__empty">{{ t('cloud.pickHint') }}</p>
    </div>

    <GameGrid v-if="games.length">
      <GameTile v-for="game in games" :key="game.id" :game="game" :href="`/play/cloud/${game.id}`" :cover-url="covers[game.id]">
        <template #actions>
          <template v-if="renaming === game.id">
            <input v-model="renameValue" class="rename-input" :aria-label="t('home.renameLabel')" @keyup.enter="commitRename" @keyup.escape="renaming = null" />
            <button type="button" class="link-button label" @click="commitRename">{{ t('home.save') }}</button>
          </template>
          <template v-else>
            <span v-if="isLocal(game)" class="label">{{ t('cloud.inMyGames') }}</span>
            <button v-else type="button" data-download class="link-button label" :disabled="!!downloadProgress" @click="download(game.id)">
              {{ downloadProgress?.gameId === game.id ? `${Math.round((downloadProgress.done / Math.max(1, downloadProgress.total)) * 100)} %` : t('cloud.download') }}
            </button>
            <button type="button" data-share class="link-button label" :disabled="sharing" @click="onShareGame(game.id)">{{ t('share.share') }}</button>
            <button type="button" class="link-button label" @click="(renaming = game.id), (renameValue = game.title)">{{ t('home.rename') }}</button>
            <button type="button" class="link-button label" :class="{ 'link-button--danger': confirmingDelete === game.id }" @click="onDelete(game.id)">
              {{ confirmingDelete === game.id ? t('home.confirmDelete') : t('home.delete') }}
            </button>
          </template>
        </template>
      </GameTile>
    </GameGrid>
    <p v-else class="cloud-library__empty">{{ t('cloud.empty') }}</p>
  </div>
</template>

<style scoped>
.cloud-library__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.cloud-library__usage {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.cloud-library__usage :deep(.storage-meter) {
  margin-top: 0;
}

.cloud-library__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.cloud-library__progress {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
}

.cloud-library__bar-track {
  height: 4px;
  background: var(--line);
  border-radius: 2px;
  overflow: hidden;
}

.cloud-library__bar-track i {
  display: block;
  height: 100%;
  background: var(--dot-blue);
  transition: width 300ms ease;
}

.cloud-library__picker {
  display: grid;
  gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 20px;
}

.cloud-library__candidate {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
}

.cloud-library__candidate:hover {
  border-color: var(--fg);
}

.cloud-library__empty {
  margin: 0;
  color: var(--fg-muted);
  font-size: 13px;
}

.pill {
  background: var(--fg);
  color: var(--bg-panel);
  border: 1px solid var(--fg);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pill--ghost {
  background: transparent;
  color: var(--fg);
  border-color: var(--line-strong);
}

.pill:disabled {
  opacity: 0.4;
  cursor: progress;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link-button--danger {
  color: var(--accent);
}

.rename-input {
  font: inherit;
  font-size: 12px;
  background: var(--bg-panel);
  color: var(--fg);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 2px 6px;
  min-width: 0;
  flex: 1;
}
</style>
