<template>
  <div class="boot-stage">
    <slot />
  </div>
</template>

<style scoped>
.boot-stage {
  position: fixed;
  inset: 0;
  background: var(--boot-bg);
  color: var(--boot-fg);
  overflow: hidden;
}
</style>
