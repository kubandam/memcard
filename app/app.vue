<script setup lang="ts">
const { siteName } = useAppConfig()

useHead({
  titleTemplate: (title) => (title ? `${title} · ${siteName}` : siteName),
  htmlAttrs: { lang: 'en' },
  meta: [
    // viewport-fit=cover: the game runs under the notch; overlays pad themselves with safe-area insets.
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#0e0e0e' },
    // "Add to Home Screen" opens without browser bars (iPhone has no other fullscreen).
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: siteName },
  ],
  link: [
    { rel: 'manifest', href: '/manifest.webmanifest' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  ],
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
