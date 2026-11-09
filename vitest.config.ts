import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.ts'],
    environmentOptions: {
      // Component tests inject <script src=…loader.js>; never fetch it in tests.
      // Vitest's own happy-dom env reads `happyDOM`, the Nuxt env reads `happyDom`.
      happyDOM: { settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true } },
      happyDom: { settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true } },
    },
  },
})
