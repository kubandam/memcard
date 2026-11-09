// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/i18n'],
  css: ['~/assets/css/tokens.css', '~/assets/css/fonts.css', '~/assets/css/base.css'],
  i18n: {
    locales: [{ code: 'en', language: 'en-US', file: 'en.json' }],
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
  },
  runtimeConfig: {
    public: {
      // EmulatorJS data folder (trailing slash). CDN for M1; self-hosted in M5.
      emulatorjsBase: 'https://cdn.emulatorjs.org/4.2.3/data/',
    },
  },
  routeRules: {
    '/play/**': { ssr: false },
    '/emulatorjs/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
})
