<script setup lang="ts">
const { siteName } = useAppConfig()

useHead({
  titleTemplate: (title) => (title ? `${title} · ${siteName}` : siteName),
  htmlAttrs: { lang: 'en' },
  script: [
    {
      // Pre-paint theme to avoid a flash of the wrong theme. Mirrors useTheme().
      innerHTML:
        "try{var t=localStorage.getItem('memcard.theme');document.documentElement.dataset.theme=(t==='grey'||t==='dark')?t:'dark'}catch(e){document.documentElement.dataset.theme='dark'}",
      tagPosition: 'head',
    },
  ],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
