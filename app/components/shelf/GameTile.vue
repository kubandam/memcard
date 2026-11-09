<script setup lang="ts">
import type { LocalGame } from '~~/shared/types/game'
import { placeholderStyle } from '~/utils/coverPlaceholder'
import { formatBytes, formatRelative } from '~/utils/format'

const props = defineProps<{ game: LocalGame; href: string; coverUrl?: string }>()
const { t } = useI18n()
</script>

<template>
  <article class="tile">
    <a :href="props.href" class="tile__cover" :style="coverUrl ? undefined : placeholderStyle(game.title)" :aria-label="t('tile.play', { title: game.title })">
      <img v-if="coverUrl" :src="coverUrl" alt="" class="tile__img" />
      <span class="tile__spine" aria-hidden="true" />
      <span class="tile__title display">{{ game.title }}</span>
    </a>
    <div class="tile__meta label">
      <span>{{ formatBytes(game.sizeBytes) }}</span>
      <span>{{ t('tile.played') }} {{ formatRelative(game.lastPlayedAt) }}</span>
    </div>
    <div v-if="$slots.actions" class="tile__actions">
      <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.tile__cover {
  position: relative;
  display: block;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius);
  box-shadow: var(--tile-shadow);
  overflow: hidden;
  text-decoration: none;
  color: var(--tile-label-fg);
}

.tile__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tile__spine {
  position: absolute;
  inset: 0 auto 0 0;
  width: 7px;
  background: var(--spine);
}

.tile__title {
  position: absolute;
  left: 15px;
  bottom: 10px;
  right: 10px;
  background: var(--tile-label-bg);
  color: var(--tile-label-fg);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 3px 6px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tile__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 10px;
}

.tile__actions {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
</style>
