<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ code: string; note: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard unavailable; the code is on screen
  }
}
</script>

<template>
  <div class="share-box" role="status">
    <code data-share-code class="share-box__code">{{ code }}</code>
    <p class="share-box__note">{{ note }}</p>
    <div class="share-box__row">
      <button type="button" class="pill" @click="copy">{{ copied ? t('cloud.copied') : t('cloud.copy') }}</button>
      <button type="button" class="pill pill--ghost" @click="emit('close')">{{ t('share.done') }}</button>
    </div>
  </div>
</template>

<style scoped>
.share-box {
  display: grid;
  gap: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--line-strong);
  border-left: 4px solid var(--dot-yellow);
  border-radius: var(--radius);
  padding: 16px 18px;
  margin-bottom: 16px;
}

.share-box__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 22px;
  letter-spacing: 0.06em;
}

.share-box__note {
  margin: 0;
  color: var(--fg-muted);
  font-size: 13px;
}

.share-box__row {
  display: flex;
  gap: 10px;
}

.pill {
  background: var(--fg);
  color: var(--bg-panel);
  border: 1px solid var(--fg);
  border-radius: 999px;
  padding: 8px 16px;
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
