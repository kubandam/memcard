<script setup lang="ts">
import { onMounted, ref } from 'vue'

const { t } = useI18n()
const { issuedShares, loadIssuedShares, revokeShare } = useCloudLibrary()
const confirming = ref<string | null>(null)

onMounted(() => {
  loadIssuedShares().catch(() => undefined)
})

async function onRevoke(id: string) {
  if (confirming.value !== id) {
    confirming.value = id
    return
  }
  confirming.value = null
  await revokeShare(id)
}

function date(ts: number) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <details class="issued">
    <summary class="label">{{ t('share.issuedTitle', { n: issuedShares.length }) }}</summary>
    <p v-if="!issuedShares.length" class="issued__empty">{{ t('share.issuedEmpty') }}</p>
    <ul v-else class="issued__list">
      <li v-for="s in issuedShares" :key="s.id" data-share-row class="issued__row">
        <span>{{ s.kind === 'library' ? t('share.wholeLibrary') : s.label }}</span>
        <span class="label">{{ date(s.createdAt) }}</span>
        <button type="button" data-revoke class="link-button label" :class="{ 'link-button--danger': confirming === s.id }" @click="onRevoke(s.id)">
          {{ confirming === s.id ? t('share.revokeConfirm') : t('share.revoke') }}
        </button>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.issued {
  margin: 8px 0 20px;
}

.issued summary {
  cursor: pointer;
}

.issued__empty {
  color: var(--fg-muted);
  font-size: 13px;
}

.issued__list {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}

.issued__row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  align-items: baseline;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link-button--danger {
  color: var(--accent);
}
</style>
