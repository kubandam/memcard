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

.theme-toggle__option[aria-pressed='true'] {
  background: var(--fg);
  color: var(--bg-panel);
}
</style>
