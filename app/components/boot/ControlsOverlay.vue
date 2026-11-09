<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { KeyBinding } from '~/utils/emulatorjs'

const props = defineProps<{ open: boolean; mapping: KeyBinding[] }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const dialog = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick()
      dialog.value?.focus()
    }
  },
)
</script>

<template>
  <div v-if="open" ref="dialog" class="controls" role="dialog" aria-modal="true" :aria-label="t('controls.title')" tabindex="-1" @keydown.escape="emit('close')">
    <div class="controls__panel">
      <h2 class="controls__title">{{ t('controls.title') }}</h2>
      <table class="controls__table">
        <thead>
          <tr>
            <th>{{ t('controls.button') }}</th>
            <th>{{ t('controls.key') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in mapping" :key="row.button">
            <td>{{ row.button }}</td>
            <td><kbd>{{ row.key || '—' }}</kbd></td>
          </tr>
        </tbody>
      </table>
      <p class="controls__hint">{{ t('controls.remapHint') }}</p>
      <p class="controls__hint">{{ t('controls.gamepadHint') }}</p>
      <p class="controls__hint">{{ t('controls.saveHint') }}</p>
      <button type="button" class="controls__close" @click="emit('close')">{{ t('controls.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
.controls {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.7);
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 300;
  color: #fff;
  overflow: auto;
  padding: 24px;
}

.controls__panel {
  width: min(520px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
  backdrop-filter: blur(8px);
  padding: 24px;
}

.controls__title {
  margin: 0 0 16px;
  font-weight: 300;
  font-size: 14px;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.5);
}

.controls__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.controls__table th {
  text-align: left;
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
  padding: 0 0 8px;
}

.controls__table td {
  padding: 5px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

kbd {
  font-family: inherit;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  padding: 1px 6px;
}

.controls__hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.controls__close {
  margin-top: 20px;
  background: #fff;
  color: #000;
  border: 0;
  border-radius: 999px;
  padding: 10px 18px;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  cursor: pointer;
  min-height: 44px;
}
</style>
