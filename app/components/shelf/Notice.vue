<script setup lang="ts">
defineProps<{ kind: 'error' | 'info' }>()
</script>

<template>
  <div class="notice" :class="`notice--${kind}`" :role="kind === 'error' ? 'alert' : 'status'">
    <slot />
  </div>
</template>

<style scoped>
.notice {
  padding: 12px 16px;
  border: 1px solid var(--line-strong);
  border-left-width: 4px;
  border-radius: var(--radius);
  background: var(--bg-panel);
  margin: 12px 0;
}

.notice--error {
  border-left-color: var(--accent);
}

.notice--info {
  border-left-color: var(--dot-blue);
}
</style>
