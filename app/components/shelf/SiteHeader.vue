<script setup lang="ts">
const { siteName } = useAppConfig()
const { t } = useI18n()
</script>

<template>
  <header class="site-header">
    <div class="container site-header__inner">
      <a href="/" class="display site-header__brand">
        <span class="site-header__square" aria-hidden="true" />
        {{ siteName }}
      </a>
      <nav class="site-header__nav" :aria-label="t('nav.label')">
        <NuxtLink to="/" class="label">{{ t('nav.home') }}</NuxtLink>
        <NuxtLink to="/settings" class="label">{{ t('nav.settings') }}</NuxtLink>
        <NuxtLink to="/about" class="label">{{ t('nav.about') }}</NuxtLink>
        <ThemeToggle />
      </nav>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  /* Home-screen app on iPhone/iPad: the status bar sits on top of the page. */
  padding-top: env(safe-area-inset-top);
  background: var(--header-bg);
  border-bottom: 1px solid var(--line);
}

.site-header__inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  min-height: 56px;
  flex-wrap: wrap;
  padding-top: 8px;
  padding-bottom: 8px;
}

.site-header__brand {
  font-size: 22px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.site-header__square {
  display: inline-block;
  width: 12px;
  height: 12px;
  background: var(--accent);
}

.site-header__nav {
  display: flex;
  align-items: center;
  gap: 18px;
}

.site-header__nav a {
  text-decoration: none;
}

.site-header__nav a.router-link-active {
  color: var(--fg);
}
</style>
