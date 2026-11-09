<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ fullscreen: []; controls: [] }>()
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
  <div class="overlay" :class="{ 'overlay--hidden': !visible }" @pointerenter="show">
    <button type="button" class="overlay__btn" @click="emit('fullscreen')">{{ t('player.fullscreen') }}</button>
    <button type="button" class="overlay__btn" @click="emit('controls')">{{ t('player.controls') }}</button>
    <a href="/" class="overlay__btn">{{ t('player.library') }}</a>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  transition: opacity 300ms ease;
  z-index: 3;
}

.overlay--hidden {
  opacity: 0;
}

.overlay__btn {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  padding: 8px 14px;
  min-height: 44px;
  text-decoration: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}
</style>
