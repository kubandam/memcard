<script setup lang="ts">
const { sourceUrl } = useAppConfig()
const { t } = useI18n()
</script>

<template>
  <footer class="site-footer">
    <div class="container site-footer__inner">
      <FourDots />
      <div class="label site-footer__links">
        <a :href="sourceUrl" rel="noopener">{{ t('footer.source') }}</a>
        <span>GPL-3.0</span>
        <span>{{ t('footer.emulator') }}</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  border-top: 1px solid var(--line);
  margin-top: 64px;
}

.site-footer__inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-top: 20px;
  padding-bottom: 28px;
  flex-wrap: wrap;
}

.site-footer__links {
  display: flex;
  gap: 18px;
}
</style>
