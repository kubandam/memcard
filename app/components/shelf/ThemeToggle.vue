<script setup lang="ts">
import type { Theme } from '~/composables/useTheme'

const { theme, setTheme, themes } = useTheme()
const { t } = useI18n()

const labels: Record<Theme, string> = {
  dark: t('theme.dark'),
  grey: t('theme.grey'),
}
</script>

<template>
  <!-- Client-only: the stored theme is unknown on the server, and Vue does not patch aria-pressed on hydration. -->
  <ClientOnly>
    <div class="theme-toggle" role="group" :aria-label="t('theme.label')">
      <button
        v-for="option in themes"
        :key="option"
        type="button"
        class="label theme-toggle__option"
        :aria-pressed="theme === option"
        @click="setTheme(option)"
      >
        {{ labels[option] }}
      </button>
    </div>
    <template #fallback>
      <div class="theme-toggle theme-toggle--placeholder" aria-hidden="true">
        <span class="label theme-toggle__option">{{ labels.dark }}</span>
        <span class="label theme-toggle__option">{{ labels.grey }}</span>
      </div>
    </template>
  </ClientOnly>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  overflow: hidden;
}

.theme-toggle__option {
  background: transparent;
  border: 0;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--fg-muted);
}

.theme-toggle--placeholder {
  visibility: hidden;
}

.theme-toggle__option[aria-pressed='true'] {
  background: var(--fg);
  color: var(--bg-panel);
}
</style>
