<script setup lang="ts">
import type { FreeGame } from '~~/shared/utils/freeGames'

const props = defineProps<{ games: FreeGame[] }>()
const emit = defineEmits<{ downloaded: [] }>()
const { t } = useI18n()
const busy = ref<string | null>(null)
const error = ref<string | null>(null)

async function download(g: FreeGame) {
  busy.value = g.id
  error.value = null
  try {
    const res = await fetch(`/api/free/${g.id}/file`)
    if (!res.ok) throw new Error('download')
    const file = new File([await res.blob()], g.file)
    const { addGame } = await import('~/utils/localDb')
    await addGame({ title: g.title, kind: 'single', primaryName: g.file, files: [file], totalBytes: file.size })
    emit('downloaded')
  } catch {
    error.value = 'cloud.network'
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section aria-labelledby="free-games" class="free">
    <div class="free__head">
      <h2 id="free-games" class="display free__title">{{ t('free.title') }}</h2>
      <span class="label">{{ t('free.subtitle') }}</span>
    </div>
    <Notice v-if="error" kind="error">{{ t(error) }}</Notice>
    <GameGrid>
      <div v-for="g in props.games" :key="g.id" class="free__item">
        <GameTile :game="{ title: g.title, sizeBytes: g.sizeBytes, lastPlayedAt: null }" :href="`/play/free/${g.id}`" :cover-url="g.cover ? `/api/free/${g.id}/cover` : undefined">
          <template #actions>
            <button type="button" class="link-button label" :disabled="busy === g.id" @click="download(g)">{{ busy === g.id ? t('free.downloading') : t('cloud.download') }}</button>
            <a class="link-button label" :href="g.sourceCode ?? g.sourceUrl" target="_blank" rel="noopener">{{ t('free.source') }}</a>
          </template>
        </GameTile>
        <p class="label free__by">{{ g.author }} · {{ g.year }} · {{ g.genre }}</p>
      </div>
    </GameGrid>

    <details class="free__credits">
      <summary class="label">{{ t('free.credits') }}</summary>
      <dl>
        <template v-for="g in props.games" :key="g.id">
          <dt class="display">{{ g.title }}</dt>
          <dd>
            <p>{{ t('free.licence') }}: {{ g.license }}</p>
            <ul>
              <li v-for="c in g.credits" :key="c">{{ c }}</li>
            </ul>
            <p>
              <a :href="g.sourceUrl" target="_blank" rel="noopener">{{ t('free.obtained') }}</a>
              <template v-if="g.sourceCode"> · <a :href="g.sourceCode" target="_blank" rel="noopener">{{ t('free.sourceCode') }}</a></template>
            </p>
          </dd>
        </template>
      </dl>
    </details>
  </section>
</template>

<style scoped>
.free__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin: 36px 0 20px;
}

.free__title {
  margin: 0;
  font-size: 34px;
}

.free__by {
  margin: 2px 0 0;
  padding-left: 13px;
  font-size: 10px;
}

.free__credits {
  margin-top: 20px;
}

.free__credits summary {
  cursor: pointer;
}

.free__credits dl {
  margin: 12px 0 0;
}

.free__credits dt {
  margin-top: 14px;
  font-size: 16px;
}

.free__credits dd {
  margin: 4px 0 0;
  color: var(--fg-muted);
  font-size: 13px;
}

.free__credits ul {
  margin: 4px 0;
  padding-left: 18px;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
}
</style>
