<template>
  <span class="four-dots" aria-hidden="true">
    <i style="background: var(--dot-red)" />
    <i style="background: var(--dot-yellow)" />
    <i style="background: var(--dot-blue)" />
    <i style="background: var(--dot-green)" />
  </span>
</template>

<style scoped>
.four-dots {
  display: inline-flex;
  gap: 6px;
}

.four-dots i {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
