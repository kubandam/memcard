<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { SharedLibrary } from '~/composables/useSharedLibraries'

const props = defineProps<{ library: SharedLibrary }>()
const emit = defineEmits<{ downloaded: [] }>()
const { t } = useI18n()
const { progress, downloadToLocal, remove, coverUrl } = useSharedLibraries()
const error = ref<string | null>(null)
const covers = ref<Record<string, string>>({})

async function loadCovers() {
  if (props.library.status !== 'ok') return
  for (const g of props.library.games) {
    if (covers.value[g.id]) continue
    const url = await coverUrl(props.library.shareId, g)
    if (url) covers.value = { ...covers.value, [g.id]: url }
  }
}

onMounted(loadCovers)
watch(() => props.library.games, loadCovers)

async function download(gameId: string) {
  const game = props.library.games.find((g) => g.id === gameId)
  if (!game) return
  error.value = null
  try {
    if (await downloadToLocal({ shareId: props.library.shareId, game, libraryId: props.library.libraryId })) emit('downloaded')
  } catch (err) {
    const n = (err as Error)?.name
    error.value = n === 'ShareRevokedError' ? 'share.invalid' : n === 'SharedGameGoneError' ? 'share.gameGone' : n === 'DecryptError' ? 'cloud.corrupt' : n === 'StorageError' ? 'errors.quota' : 'cloud.network'
  }
}
</script>

<template>
  <section class="shared">
    <div class="shared__head">
      <h2 class="display shared__title">{{ t('share.sharedLibrary') }}</h2>
      <div class="shared__meta">
        <span class="label">{{ t('share.readOnly') }}</span>
        <button type="button" data-remove-shared class="link-button label" @click="remove(library.shareId)">{{ t('share.remove') }}</button>
      </div>
    </div>

    <Notice v-if="library.status === 'revoked'" kind="error">{{ t('share.revokedLibrary') }}</Notice>
    <Notice v-else-if="library.status === 'error'" kind="error">{{ t('cloud.network') }}</Notice>
    <Notice v-if="error" kind="error">{{ t(error) }}</Notice>

    <GameGrid v-if="library.status === 'ok' && library.games.length">
      <GameTile v-for="game in library.games" :key="game.id" :game="game" :href="`/play/shared/${game.id}?share=${library.shareId}`" :cover-url="covers[game.id]">
        <template #actions>
          <button type="button" data-download class="link-button label" :disabled="!!progress" @click="download(game.id)">
            {{ progress?.key === `${library.shareId}:${game.id}` ? `${Math.round((progress.done / Math.max(1, progress.total)) * 100)} %` : t('cloud.download') }}
          </button>
        </template>
      </GameTile>
    </GameGrid>
    <p v-else-if="library.status === 'ok'" class="shared__empty">{{ t('share.emptyLibrary') }}</p>
  </section>
</template>

<style scoped>
.shared__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin: 36px 0 20px;
}

.shared__title {
  margin: 0;
  font-size: 34px;
}

.shared__meta {
  display: flex;
  gap: 18px;
  align-items: baseline;
}

.shared__empty {
  color: var(--fg-muted);
  margin: 0;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
