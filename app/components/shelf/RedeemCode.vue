<script setup lang="ts">
import { ref } from 'vue'
import type { RedeemResult } from '~/composables/useSharedLibraries'
import { formatBytes } from '~/utils/format'

const emit = defineEmits<{ downloaded: []; added: [] }>()
const { t } = useI18n()
const { progress, redeem, downloadToLocal } = useSharedLibraries()

const code = ref('')
const busy = ref(false)
const result = ref<RedeemResult | null>(null)
const error = ref<string | null>(null)
const done = ref(false)

const errorKey: Record<string, string> = { format: 'share.badFormat', invalid: 'share.invalid', rate: 'share.tooMany', network: 'cloud.network' }

async function onRedeem() {
  if (!code.value.trim()) return
  busy.value = true
  error.value = null
  done.value = false
  result.value = null
  try {
    const res = await redeem(code.value)
    if ('error' in res) error.value = errorKey[res.error] ?? 'cloud.network'
    else {
      result.value = res
      if (res.kind === 'library') emit('added')
    }
  } finally {
    busy.value = false
  }
}

async function onDownload() {
  if (!result.value || !('kind' in result.value) || result.value.kind !== 'game') return
  error.value = null
  try {
    const added = await downloadToLocal(result.value)
    if (added) {
      done.value = true
      emit('downloaded')
    }
  } catch (err) {
    error.value = (err as Error)?.name === 'ShareRevokedError' ? 'share.invalid' : (err as Error)?.name === 'StorageError' ? 'errors.quota' : 'cloud.network'
  }
}
</script>

<template>
  <div class="redeem">
    <form data-redeem class="redeem__form" @submit.prevent="onRedeem">
      <input
        v-model="code"
        data-code
        type="text"
        class="field"
        autocomplete="off"
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
        :placeholder="t('share.codePlaceholder')"
        :aria-label="t('share.codePlaceholder')"
      />
      <button type="submit" class="pill" :disabled="busy || !code.trim()">{{ busy ? t('share.checking') : t('share.redeem') }}</button>
    </form>

    <Notice v-if="error" kind="error">{{ t(error) }}</Notice>

    <div v-if="result && 'kind' in result && result.kind === 'game'" class="redeem__game">
      <div>
        <p class="display redeem__title">{{ result.game.title }}</p>
        <p class="label">{{ formatBytes(result.game.sizeBytes) }} · {{ t('share.fromCode') }}</p>
      </div>
      <p v-if="done" class="label" role="status">{{ t('share.added') }}</p>
      <button v-else type="button" data-download-shared class="pill" :disabled="!!progress" @click="onDownload">
        {{ progress ? `${Math.round((progress.done / Math.max(1, progress.total)) * 100)} %` : t('share.downloadToMyGames') }}
      </button>
    </div>
    <p v-else-if="result && 'kind' in result && result.kind === 'library'" class="label" role="status">{{ t('share.libraryAdded') }}</p>
  </div>
</template>

<style scoped>
.redeem {
  display: grid;
  gap: 10px;
}

.redeem__form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.redeem__game {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: var(--bg-panel);
  border: 1px solid var(--line-strong);
  border-left: 4px solid var(--dot-blue);
  border-radius: var(--radius);
  padding: 14px 16px;
}

.redeem__title {
  margin: 0 0 4px;
  font-size: 20px;
}

.field {
  flex: 1;
  min-width: 220px;
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.05em;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 10px 12px;
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

.pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
