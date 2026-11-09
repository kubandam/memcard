<script setup lang="ts">
import type { LocalGame } from '~~/shared/types/game'
import { accentHue, placeholderStyle } from '~/utils/coverPlaceholder'
import { formatBytes, formatRelative } from '~/utils/format'

const props = defineProps<{ game: Pick<LocalGame, 'title' | 'sizeBytes' | 'lastPlayedAt'>; href: string; coverUrl?: string }>()
const { t } = useI18n()
</script>

<template>
  <article class="tile" :style="{ '--tile-accent': `hsl(${accentHue(game.title)} 80% 55%)` }">
    <a :href="props.href" class="tile__cover" :style="coverUrl ? undefined : placeholderStyle(game.title)" :aria-label="t('tile.play', { title: game.title })">
      <img v-if="coverUrl" :src="coverUrl" alt="" class="tile__img" />
      <span v-else class="tile__initial display" aria-hidden="true">{{ game.title.slice(0, 1) }}</span>
      <span class="tile__spine" aria-hidden="true" />
      <span class="tile__play label">{{ t('tile.playShort') }}</span>
    </a>
    <div class="tile__head">
      <h3 class="tile__title display">{{ game.title }}</h3>
      <details v-if="$slots.actions" class="tile__menu">
        <summary :aria-label="t('tile.more')">⋯</summary>
        <div class="tile__menu-list">
          <slot name="actions" />
        </div>
      </details>
    </div>
    <div class="tile__meta label">
      <span>{{ formatBytes(game.sizeBytes) }}</span>
      <span>·</span>
      <span>{{ game.lastPlayedAt ? `${t('tile.played')} ${formatRelative(game.lastPlayedAt)}` : t('tile.notPlayed') }}</span>
    </div>
  </article>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tile__cover {
  position: relative;
  display: block;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius);
  box-shadow: var(--tile-shadow);
  overflow: hidden;
  text-decoration: none;
  color: var(--tile-label-fg);
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.tile__cover:hover,
.tile__cover:focus-visible {
  transform: translateY(-3px);
  box-shadow: var(--tile-shadow), 0 0 0 2px var(--tile-accent), 0 14px 36px var(--tile-accent-shadow, transparent);
}

.tile__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tile__initial {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: clamp(64px, 9vw, 120px);
  color: var(--tile-label-fg);
  opacity: 0.18;
}

.tile__spine {
  position: absolute;
  inset: 0 auto 0 0;
  width: 8px;
  background: var(--spine);
}

.tile__spine::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--tile-accent);
  opacity: 0.9;
  width: 3px;
  left: 8px;
}

.tile__play {
  position: absolute;
  right: 10px;
  bottom: 10px;
  background: var(--tile-label-bg);
  color: var(--tile-label-fg);
  padding: 4px 8px;
  font-size: 9px;
  opacity: 0;
  transition: opacity 160ms ease;
}

.tile__cover:hover .tile__play,
.tile__cover:focus-visible .tile__play {
  opacity: 1;
}

.tile__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 2px;
}

.tile__menu {
  position: relative;
  margin-left: auto;
  flex: none;
}

.tile__menu summary {
  list-style: none;
  cursor: pointer;
  padding: 0 6px;
  border-radius: var(--radius);
  font-size: 20px;
  line-height: 1;
  color: var(--fg-muted);
}

.tile__menu summary::-webkit-details-marker {
  display: none;
}

.tile__menu[open] summary,
.tile__menu summary:hover {
  color: var(--fg);
  background: var(--bg-panel);
}

.tile__menu-list {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 5;
  min-width: 180px;
  display: grid;
  gap: 2px;
  padding: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  box-shadow: var(--tile-shadow);
}

.tile__menu-list :deep(button),
.tile__menu-list :deep(label),
.tile__menu-list :deep(span) {
  display: block;
  text-align: left;
  text-decoration: none;
  padding: 8px 10px;
  border-radius: var(--radius);
}

.tile__menu-list :deep(button:hover),
.tile__menu-list :deep(label:hover) {
  background: var(--bg);
}

.tile__title {
  margin: 0;
  font-size: 18px;
  line-height: 1.15;
  border-left: 3px solid var(--tile-accent);
  padding-left: 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tile__meta {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  padding-left: 13px;
  font-size: 10px;
}
</style>
