<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ recoveryKey: string }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.recoveryKey)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard unavailable; the key is on screen
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([`${t('cloud.recoveryFileIntro')}\n\n${props.recoveryKey}\n`], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'memcard-recovery-key.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="recovery">
    <p class="recovery__lead">{{ t('cloud.created') }}</p>
    <p class="label">{{ t('cloud.recoveryTitle') }}</p>
    <code class="recovery__code">{{ recoveryKey }}</code>
    <p class="recovery__hint">{{ t('cloud.recoveryHint') }}</p>
    <div class="recovery__row">
      <button type="button" class="pill" @click="download">{{ t('cloud.recoveryDownload') }}</button>
      <button type="button" class="pill pill--ghost" @click="copy">{{ copied ? t('cloud.copied') : t('cloud.copy') }}</button>
      <button type="button" data-recovery-done class="pill pill--ghost" @click="emit('done')">{{ t('cloud.recoveryDone') }}</button>
    </div>
  </div>
</template>

<style scoped>
.recovery {
  display: grid;
  gap: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--line-strong);
  border-left: 4px solid var(--dot-green);
  border-radius: var(--radius);
  padding: 18px 20px;
  margin-bottom: 20px;
}

.recovery__lead,
.recovery__hint {
  margin: 0;
}

.recovery__hint {
  color: var(--fg-muted);
  font-size: 13px;
}

.recovery__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
  word-break: break-all;
}

.recovery__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pill {
  background: var(--fg);
  color: var(--bg-panel);
  border: 1px solid var(--fg);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pill--ghost {
  background: transparent;
  color: var(--fg);
  border-color: var(--line-strong);
}
</style>
