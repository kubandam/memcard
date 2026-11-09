<template>
  <div class="section-label">
    <h2 class="label section-label__title"><slot /></h2>
    <div v-if="$slots.meta" class="label"><slot name="meta" /></div>
  </div>
</template>

<style scoped>
.section-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin: 32px 0 12px;
}

.section-label__title {
  margin: 0;
}
</style>
