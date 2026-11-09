<script setup lang="ts">
import type { EmulatorPhase } from '~/composables/useEmulator'

const props = defineProps<{ title: string; phase: EmulatorPhase; progress: number; error?: string | null }>()
const { t } = useI18n()
</script>

<template>
  <div class="boot" :class="{ 'boot--hidden': phase === 'running' }" aria-live="polite">
    <div class="boot__blocks" aria-hidden="true">
      <i class="boot__blk boot__blk--a" />
      <i class="boot__blk boot__blk--b" />
      <i class="boot__blk boot__blk--c" />
    </div>
    <div class="boot__center">
      <h1 class="boot__title">{{ title }}</h1>
      <div class="boot__bar" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
        <i :style="{ width: `${progress * 100}%` }" :class="{ 'boot__bar--pulse': phase === 'loading' }" />
      </div>
      <p class="boot__status">
        <template v-if="phase === 'error'">{{ props.error }}</template>
        <template v-else>{{ t(`boot.${phase}`) }} · {{ Math.round(progress * 100) }}%</template>
      </p>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.boot {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transition: opacity 600ms ease;
  z-index: 2;
}

.boot--hidden {
  opacity: 0;
  pointer-events: none;
}

.boot__blocks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.boot__blk {
  position: absolute;
  display: block;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.01));
  box-shadow: 0 0 24px rgba(160, 170, 255, 0.12);
  transform: rotate(14deg) skew(-6deg);
  animation: drift 14s ease-in-out infinite alternate;
}

.boot__blk--a { left: 62%; top: 12%; width: 72px; height: 72px; opacity: 0.6; }
.boot__blk--b { left: 76%; top: 34%; width: 44px; height: 44px; opacity: 0.45; animation-delay: -4s; }
.boot__blk--c { left: 14%; top: 64%; width: 30px; height: 30px; opacity: 0.3; animation-delay: -9s; }

@keyframes drift {
  from { translate: 0 0; }
  to { translate: 18px -26px; }
}

.boot__center {
  text-align: center;
  padding: 0 24px;
  width: min(560px, 100%);
}

.boot__title {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 300;
  font-size: clamp(16px, 2.4vw, 22px);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  text-shadow: 0 0 14px rgba(255, 255, 255, 0.6);
  margin: 0 0 20px;
  color: #fff;
}

.boot__bar {
  height: 2px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}

.boot__bar i {
  display: block;
  height: 100%;
  background: #fff;
  box-shadow: 0 0 10px #fff;
  transition: width 400ms ease;
}

.boot__bar--pulse {
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes pulse {
  50% { opacity: 0.45; }
}

.boot__status {
  margin: 14px 0 0;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 300;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.65);
}
</style>
