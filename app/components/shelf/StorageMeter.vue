<script setup lang="ts">
import { computed } from 'vue'
import { formatBytes } from '~/utils/format'

const props = defineProps<{ usage: number; quota: number }>()
const { t } = useI18n()
const percent = computed(() => (props.quota > 0 ? Math.min(100, (props.usage / props.quota) * 100) : 0))
</script>

<template>
  <div class="storage-meter">
    <div class="storage-meter__bar" role="progressbar" :aria-valuenow="Math.round(percent)" aria-valuemin="0" aria-valuemax="100">
      <i :style="{ width: `${percent}%` }" />
    </div>
    <span class="label">{{ t('storage.used', { used: formatBytes(usage), total: formatBytes(quota) }) }}</span>
  </div>
</template>

<style scoped>
.storage-meter {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.storage-meter__bar {
  flex: 1;
  max-width: 240px;
  height: 4px;
  background: var(--line);
  border-radius: 2px;
  overflow: hidden;
}

.storage-meter__bar i {
  display: block;
  height: 100%;
  background: var(--fg);
}
</style>
