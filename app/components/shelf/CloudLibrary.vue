<script setup lang="ts">
const { t } = useI18n()
const { games, recoveryKey, close } = useCloudLibrary()
</script>

<template>
  <div class="cloud-library">
    <RecoveryKeyBox v-if="recoveryKey" :recovery-key="recoveryKey" @done="recoveryKey = null" />
    <div class="cloud-library__bar">
      <span class="label">{{ t('cloud.gamesCount', { n: games.length }) }}</span>
      <button type="button" data-close class="link-button label" @click="close">{{ t('cloud.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
.cloud-library__bar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
