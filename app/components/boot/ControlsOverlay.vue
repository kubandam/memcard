<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { KeyBinding } from '~/utils/emulatorjs'
import { RIGHT_STICK_MODES, type RightStickMode } from '~/utils/gamepadFix'

const props = defineProps<{ open: boolean; mapping: KeyBinding[]; rightStick: RightStickMode }>()
const emit = defineEmits<{ close: []; 'update:rightStick': [mode: RightStickMode] }>()
const { t } = useI18n()
const dialog = ref<HTMLElement | null>(null)
const tab = ref<'controller' | 'keyboard'>('controller')
/** Name of the first connected controller, refreshed while the dialog is open. */
const padName = ref<string | null>(null)
let poll: ReturnType<typeof setInterval> | null = null

function readPad() {
  try {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean)
    // "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c …)" → "DualSense Wireless Controller"
    padName.value = pad ? pad.id.replace(/\s*\(.*$/, '').trim() || pad.id : null
  } catch {
    padName.value = null
  }
}

watch(
  () => props.open,
  async (open) => {
    if (poll) clearInterval(poll)
    poll = null
    if (!open) return
    readPad()
    poll = setInterval(readPad, 500)
    await nextTick()
    dialog.value?.focus()
  },
  { immediate: true },
)
onBeforeUnmount(() => poll && clearInterval(poll))

/** PS1 button → where it sits on a DualSense / DualShock (same layout since the face-button fix). */
const FACE = [
  { ps: '✕', name: 'Cross', where: 'bottom' },
  { ps: '○', name: 'Circle', where: 'right' },
  { ps: '□', name: 'Square', where: 'left' },
  { ps: '△', name: 'Triangle', where: 'top' },
] as const
</script>

<template>
  <div v-if="open" ref="dialog" class="controls" role="dialog" aria-modal="true" :aria-label="t('controls.title')" tabindex="-1" @keydown.escape="emit('close')">
    <div class="controls__panel">
      <h2 class="controls__title">{{ t('controls.title') }}</h2>
      <div class="controls__tabs" role="tablist">
        <button type="button" role="tab" data-tab="controller" :aria-selected="tab === 'controller'" class="controls__tab" @click="tab = 'controller'">{{ t('controls.controller') }}</button>
        <button type="button" role="tab" data-tab="keyboard" :aria-selected="tab === 'keyboard'" class="controls__tab" @click="tab = 'keyboard'">{{ t('controls.keyboard') }}</button>
      </div>

      <template v-if="tab === 'controller'">
        <p class="controls__status" data-pad-status>
          <i class="controls__dot" :class="{ 'controls__dot--on': padName }" aria-hidden="true" />
          {{ padName ? t('controls.padConnected', { name: padName }) : t('controls.padNone') }}
        </p>
        <table class="controls__table">
          <tbody>
            <tr v-for="f in FACE" :key="f.name">
              <td><span class="glyph">{{ f.ps }}</span> {{ f.name }}</td>
              <td>{{ t(`controls.where.${f.where}`) }}</td>
            </tr>
            <tr><td>L1 · R1 · L2 · R2</td><td>{{ t('controls.same') }}</td></tr>
            <tr><td>Start · Select</td><td>Options · Create</td></tr>
            <tr><td>{{ t('controls.leftStick') }}</td><td>{{ t('controls.leftStickDoes') }}</td></tr>
          </tbody>
        </table>
        <fieldset class="controls__choice">
          <legend>{{ t('controls.rightStick') }}</legend>
          <div class="controls__segments">
            <button
              v-for="m in RIGHT_STICK_MODES"
              :key="m"
              type="button"
              class="controls__segment"
              :data-right-stick="m"
              :aria-pressed="rightStick === m"
              @click="emit('update:rightStick', m)"
            >
              {{ t(`controls.rightStickMode.${m}`) }}
            </button>
          </div>
          <p class="controls__hint">{{ t('controls.rightStickHint') }}</p>
        </fieldset>
      </template>

      <template v-else>
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
      </template>

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
  background: var(--boot-scrim);
  font-family: var(--boot-font);
  font-weight: 300;
  color: var(--boot-fg);
  overflow: auto;
  padding: 24px;
}

.controls__panel {
  width: min(520px, 100%);
  border: 1px solid var(--boot-line);
  background: var(--boot-panel);
  backdrop-filter: blur(8px);
  padding: 24px;
}

.controls__title {
  margin: 0 0 16px;
  font-weight: 300;
  font-size: 14px;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  text-shadow: 0 0 12px var(--boot-glow);
}

.controls__tabs {
  display: flex;
  gap: 18px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--boot-line-soft);
}

.controls__tab {
  background: none;
  border: 0;
  border-bottom: 1px solid transparent;
  margin-bottom: -1px;
  padding: 8px 0;
  color: var(--boot-fg-muted);
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  cursor: pointer;
  min-height: 44px;
}

.controls__tab[aria-selected='true'] {
  color: var(--boot-fg);
  border-bottom-color: var(--boot-fg);
  text-shadow: 0 0 10px var(--boot-glow);
}

.controls__status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 14px;
  font-size: 13px;
}

.controls__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--boot-line);
  flex: none;
}

.controls__dot--on {
  background: var(--boot-fg);
  box-shadow: 0 0 10px var(--boot-glow);
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
  color: var(--boot-fg-muted);
  padding: 0 0 8px;
}

.controls__table td {
  padding: 5px 0;
  border-top: 1px solid var(--boot-line-soft);
}

.controls__table td + td {
  color: var(--boot-fg-muted);
}

.glyph {
  display: inline-block;
  width: 1.4em;
  text-align: center;
}

kbd {
  font-family: inherit;
  border: 1px solid var(--boot-line);
  border-radius: 3px;
  padding: 1px 6px;
}

.controls__choice {
  border: 0;
  margin: 18px 0 0;
  padding: 0;
}

.controls__choice legend {
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--boot-fg-muted);
  margin-bottom: 8px;
}

.controls__segments {
  display: inline-flex;
  border: 1px solid var(--boot-line);
  border-radius: 999px;
  overflow: hidden;
}

.controls__segment {
  background: transparent;
  color: var(--boot-fg-muted);
  border: 0;
  padding: 10px 16px;
  min-height: 40px;
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
}

.controls__segment[aria-pressed='true'] {
  background: var(--boot-button-bg);
  color: var(--boot-button-fg);
}

.controls__hint {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--boot-fg-muted);
}

.controls__close {
  margin-top: 20px;
  background: var(--boot-button-bg);
  color: var(--boot-button-fg);
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
