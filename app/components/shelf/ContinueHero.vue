<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatRelative } from '~/utils/format'

const { t } = useI18n()
const { games, coverUrl, snapshot } = useCloudLibrary()

/** The most recently played game of the open library. */
const last = computed(() => games.value.filter((g) => g.lastPlayedAt).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))[0] ?? null)
const cover = ref<string | undefined>()
const shot = ref<{ url: string; updatedAt: number } | null>(null)

watch(
  () => last.value?.id,
  async () => {
    cover.value = undefined
    shot.value = null
    const g = last.value
    if (!g) return
    const [c, s] = await Promise.all([coverUrl(g), snapshot(g)])
    if (last.value?.id !== g.id) return
    cover.value = c
    shot.value = s
  },
  { immediate: true },
)

const background = computed(() => shot.value?.url ?? cover.value)
function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section v-if="last" class="hero" :aria-label="t('hero.label')">
    <div data-hero-bg class="hero__bg" :style="background ? { backgroundImage: `url(${background})` } : undefined" />
    <div class="hero__shade" />
    <i class="hero__blk hero__blk--a" aria-hidden="true" />
    <i class="hero__blk hero__blk--b" aria-hidden="true" />
    <div class="hero__inner">
      <img v-if="cover" :src="cover" alt="" class="hero__cover" />
      <div class="hero__text">
        <p class="hero__kicker">{{ t('hero.kicker') }}</p>
        <h2 class="hero__title">{{ last.title }}</h2>
        <p class="hero__meta">
          {{ t('hero.played', { when: formatRelative(last.lastPlayedAt) }) }}
          <template v-if="shot"> · {{ t('hero.snapshot', { time: time(shot.updatedAt) }) }}</template>
        </p>
        <div class="hero__actions">
          <a data-continue class="hero__play" :href="shot ? `/play/cloud/${last.id}?resume=1` : `/play/cloud/${last.id}`">▶ {{ shot ? t('hero.continue') : t('hero.play') }}</a>
          <a v-if="shot" data-start-over class="hero__ghost" :href="`/play/cloud/${last.id}`">{{ t('hero.startOver') }}</a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  min-height: 300px;
  display: flex;
  align-items: flex-end;
  padding: 28px;
  margin: 32px 0 8px;
  background: var(--boot-bg);
  color: var(--boot-fg);
  isolation: isolate;
}

.hero__bg {
  position: absolute;
  inset: -30px;
  background-size: cover;
  background-position: center;
  filter: blur(22px) brightness(0.5) saturate(1.25);
  transform: scale(1.05);
  z-index: -2;
  transition: background-image 300ms ease;
}

.hero__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, var(--boot-scrim) 0%, transparent 70%);
  z-index: -1;
}

.hero__blk {
  position: absolute;
  display: block;
  border: 1px solid var(--boot-line);
  background: var(--boot-glass);
  box-shadow: var(--boot-glass-shadow);
  transform: rotate(14deg) skew(-6deg);
  animation: hero-drift 16s ease-in-out infinite alternate;
  z-index: -1;
}

.hero__blk--a { right: 14%; top: 14%; width: 78px; height: 78px; }
.hero__blk--b { right: 6%; top: 46%; width: 42px; height: 42px; opacity: 0.6; animation-delay: -6s; }

@keyframes hero-drift {
  to { translate: 14px -20px; }
}

.hero__inner {
  display: flex;
  align-items: flex-end;
  gap: 24px;
  width: 100%;
}

.hero__cover {
  width: 150px;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 4px;
  border-left: 6px solid var(--spine);
  box-shadow: 0 18px 40px var(--boot-scrim);
  flex: none;
}

.hero__text {
  min-width: 0;
}

.hero__kicker,
.hero__meta {
  margin: 0;
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: 11px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--boot-fg-muted);
}

.hero__title {
  margin: 8px 0 10px;
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: clamp(22px, 3.4vw, 38px);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  line-height: 1.15;
  text-shadow: 0 0 18px var(--boot-glow);
  overflow-wrap: anywhere;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.hero__play,
.hero__ghost {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 22px;
  border-radius: 999px;
  font-family: var(--boot-font);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-decoration: none;
}

.hero__play {
  background: var(--boot-button-bg);
  color: var(--boot-button-fg);
}

.hero__ghost {
  border: 1px solid var(--boot-line);
  color: var(--boot-fg);
}

@media (max-width: 640px) {
  .hero {
    padding: 18px;
    min-height: 0;
  }

  .hero__inner {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero__cover {
    width: 110px;
  }

  .hero__title {
    letter-spacing: 0.18em;
  }
}
</style>
