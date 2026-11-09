<template>
  <div class="shelf">
    <SiteHeader />
    <main class="container shelf__main">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.shelf {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.shelf__main {
  flex: 1;
  width: 100%;
  padding-bottom: 32px;
}
</style>
