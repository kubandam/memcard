<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

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
const emit = defineEmits<{ fullscreen: []; controls: []; leave: []; sound: [] }>()

function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const { t } = useI18n()
const visible = ref(true)
let timer: ReturnType<typeof setTimeout> | undefined

function show() {
  visible.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (visible.value = false), 2500)
}

onMounted(() => {
  window.addEventListener('pointermove', show, { passive: true })
  window.addEventListener('pointerdown', show, { passive: true })
  show()
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', show)
  window.removeEventListener('pointerdown', show)
  clearTimeout(timer)
})
</script>

<template>
  <div class="overlay" :class="{ 'overlay--hidden': !visible && !props.soundBlocked }" @pointerenter="show">
    <button v-if="props.soundBlocked" type="button" class="overlay__btn overlay__btn--sound" data-sound-blocked @click="emit('sound')">{{ t('player.tapForSound') }}</button>
    <button v-if="props.canFullscreen" type="button" class="overlay__btn" @click="emit('fullscreen')">{{ t('player.fullscreen') }}</button>
    <button type="button" class="overlay__btn" @click="emit('controls')">{{ t('player.controls') }}</button>
    <a href="/" class="overlay__btn" @click.prevent="emit('leave')">{{ t('player.library') }}</a>
    <span v-if="props.saveStatus && props.saveStatus !== 'idle'" class="overlay__save" data-save-status>
      <template v-if="props.saveStatus === 'synced' && props.savedAt">{{ t('save.synced', { time: time(props.savedAt) }) }}</template>
      <template v-else-if="props.saveStatus === 'offline'">{{ t('save.offline') }}</template>
      <template v-else-if="props.saveStatus === 'error'">{{ t('save.error') }}</template>
    </span>
    <span v-if="props.saveNotice" class="overlay__save overlay__save--notice">{{ props.saveNotice }}</span>
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

.overlay__save--notice {
  opacity: 1;
}

.overlay__btn--sound {
  color: var(--overlay-bg);
  background: var(--overlay-fg);
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
