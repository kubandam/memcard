<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    saveStatus?: 'idle' | 'synced' | 'offline' | 'error' | null
    savedAt?: number | null
    saveNotice?: string | null
    /** False on iPhone, where pages cannot go fullscreen. */
    canFullscreen?: boolean
    /** The browser is holding the sound back until the screen is touched. */
    soundBlocked?: boolean
  }>(),
  { canFullscreen: true, soundBlocked: false },
)
const emit = defineEmits<{ fullscreen: []; controls: []; leave: []; sound: []; menu: [] }>()

function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const { t } = useI18n()
/** Hidden at start: the game starts clean; a mouse move or a tap brings the buttons up. */
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function show() {
  visible.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (visible.value = false), 3000)
}

/** Messages ("Continue loaded", "Saved") show on their own for a few seconds. */
const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.saveNotice,
  (msg) => {
    toast.value = msg ?? null
    clearTimeout(toastTimer)
    if (msg) toastTimer = setTimeout(() => (toast.value = null), 4000)
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('pointermove', show, { passive: true })
  window.addEventListener('pointerdown', show, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', show)
  window.removeEventListener('pointerdown', show)
  clearTimeout(timer)
  clearTimeout(toastTimer)
})
</script>

<template>
  <button v-if="props.soundBlocked" type="button" class="sound-pill" data-sound-blocked @click="emit('sound')">{{ t('player.tapForSound') }}</button>
  <p v-if="toast" class="toast" role="status">{{ toast }}</p>
  <div class="overlay" :class="{ 'overlay--hidden': !visible }" data-player-overlay @pointerenter="show">
    <button v-if="props.canFullscreen" type="button" class="overlay__btn" @click="emit('fullscreen')">{{ t('player.fullscreen') }}</button>
    <button type="button" class="overlay__btn" @click="emit('menu')">{{ t('player.menu') }}</button>
    <button type="button" class="overlay__btn" @click="emit('controls')">{{ t('player.controls') }}</button>
    <a href="/" class="overlay__btn" @click.prevent="emit('leave')">{{ t('player.library') }}</a>
    <span v-if="props.saveStatus && props.saveStatus !== 'idle'" class="overlay__save" data-save-status>
      <template v-if="props.saveStatus === 'synced' && props.savedAt">{{ t('save.synced', { time: time(props.savedAt) }) }}</template>
      <template v-else-if="props.saveStatus === 'offline'">{{ t('save.offline') }}</template>
      <template v-else-if="props.saveStatus === 'error'">{{ t('save.error') }}</template>
    </span>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  /* Clear of the notch / camera cut-out and rounded corners. */
  padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 10px max(10px, env(safe-area-inset-left));
  transition: opacity 300ms ease;
  z-index: 3;
}

.overlay__save {
  align-self: center;
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--overlay-fg);
  opacity: 0.8;
}

/* The one thing shown over a running game when needed: one tap and it is gone. */
.sound-pill {
  position: absolute;
  left: 50%;
  bottom: max(16px, env(safe-area-inset-bottom));
  translate: -50% 0;
  z-index: 4;
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--overlay-bg);
  background: var(--overlay-fg);
  border: 0;
  border-radius: 999px;
  padding: 8px 16px;
  min-height: 44px;
  cursor: pointer;
}

.toast {
  position: absolute;
  left: 50%;
  /* Above the sound pill when both show. */
  bottom: calc(max(16px, env(safe-area-inset-bottom)) + 56px);
  translate: -50% 0;
  z-index: 3;
  margin: 0;
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--overlay-fg);
  background: var(--overlay-bg);
  border-radius: 999px;
  padding: 8px 14px;
  pointer-events: none;
}

.overlay--hidden {
  opacity: 0;
  pointer-events: none;
}

.overlay__btn {
  font-family: var(--boot-font);
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--overlay-fg);
  background: var(--overlay-bg);
  border: 1px solid var(--overlay-line);
  border-radius: 999px;
  padding: 8px 14px;
  min-height: 44px;
  text-decoration: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
</style>
