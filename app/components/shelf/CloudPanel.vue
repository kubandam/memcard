<script setup lang="ts">
import { computed, ref } from 'vue'
import words from '~/assets/wordlist/eff-short-1.json'
import { generatePassphrase, isStrongSecret } from '~~/shared/utils/passphrase'

const { t } = useI18n()
const { status, notice, open, create } = useCloudLibrary()

const secret = ref('')
const reveal = ref(false)
const mode = ref<'open' | 'create'>('open')
const ownPassword = ref(false)
const generated = ref('')
const custom = ref('')
const invite = ref('')
const wrote = ref(false)
const recoveryKey = ref<string | null>(null)
const copied = ref(false)
const stayOpen = ref(false)

const chosen = computed(() => (ownPassword.value ? custom.value : generated.value))
const weak = computed(() => ownPassword.value && custom.value.length > 0 && !isStrongSecret(custom.value))
const canCreate = computed(() => isStrongSecret(chosen.value) && invite.value.trim().length > 0 && wrote.value && status.value !== 'opening')

function startCreate() {
  mode.value = 'create'
  generated.value = generatePassphrase(words, 5)
  recoveryKey.value = null
}

async function onOpen() {
  if (secret.value.trim()) await open(secret.value, { remember: stayOpen.value })
}

async function onCreate() {
  const res = await create(chosen.value, invite.value, { remember: stayOpen.value })
  if (res) recoveryKey.value = res.recoveryKey
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard unavailable; the text is on screen
  }
}

</script>

<template>
  <div class="cloud-panel">
    <Notice v-if="notice" :kind="notice.kind">{{ t(notice.key) }}</Notice>

    <RecoveryKeyBox v-if="recoveryKey" :recovery-key="recoveryKey" @done="recoveryKey = null" />

    <form v-else-if="mode === 'open'" data-open class="cloud-panel__form" @submit.prevent="onOpen">
      <p class="cloud-panel__lead">{{ t('cloud.openLead') }}</p>
      <div class="cloud-panel__row">
        <input
          v-model="secret"
          data-secret
          :type="reveal ? 'text' : 'password'"
          autocomplete="current-password"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :placeholder="t('cloud.secretPlaceholder')"
          class="field"
          :aria-label="t('cloud.secretPlaceholder')"
        />
        <button type="button" class="pill pill--ghost" @click="reveal = !reveal">{{ reveal ? t('cloud.hide') : t('cloud.show') }}</button>
        <button type="submit" class="pill" :disabled="status === 'opening' || !secret.trim()">
          {{ status === 'opening' ? t('cloud.opening') : t('cloud.open') }}
        </button>
      </div>
      <label class="cloud-panel__check">
        <input v-model="stayOpen" data-remember type="checkbox" />
        {{ t('cloud.stayOpen') }}
      </label>
      <p class="cloud-panel__hint">
        {{ t('cloud.noLibraryYet') }}
        <button type="button" data-start-create class="link-button label" @click="startCreate">{{ t('cloud.createNew') }}</button>
      </p>
    </form>

    <div v-else class="cloud-panel__form">
      <p class="cloud-panel__lead">{{ t('cloud.createLead') }}</p>

      <template v-if="!ownPassword">
        <p class="label">{{ t('cloud.yourPassphrase') }}</p>
        <code data-passphrase class="cloud-panel__code cloud-panel__code--big">{{ generated }}</code>
        <div class="cloud-panel__row">
          <button type="button" class="pill pill--ghost" @click="copy(generated)">{{ copied ? t('cloud.copied') : t('cloud.copy') }}</button>
          <button type="button" class="pill pill--ghost" @click="generated = generatePassphrase(words, 5)">{{ t('cloud.another') }}</button>
          <button type="button" data-own-password class="link-button label" @click="ownPassword = true">{{ t('cloud.useOwn') }}</button>
        </div>
      </template>
      <template v-else>
        <input v-model="custom" data-custom type="text" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" class="field" :placeholder="t('cloud.ownPlaceholder')" :aria-label="t('cloud.ownPlaceholder')" />
        <p v-if="weak" data-weak class="cloud-panel__warn">{{ t('cloud.weak') }}</p>
        <button type="button" class="link-button label" @click="ownPassword = false">{{ t('cloud.useGenerated') }}</button>
      </template>

      <p class="cloud-panel__warn">{{ t('cloud.forgetWarning') }}</p>
      <label class="cloud-panel__check">
        <input v-model="wrote" data-wrote type="checkbox" />
        {{ t('cloud.wroteItDown') }}
      </label>
      <label class="cloud-panel__check">
        <input v-model="stayOpen" data-remember-create type="checkbox" />
        {{ t('cloud.stayOpen') }}
      </label>
      <input v-model="invite" data-invite type="text" class="field" :placeholder="t('cloud.invitePlaceholder')" :aria-label="t('cloud.invitePlaceholder')" />
      <div class="cloud-panel__row">
        <button type="button" data-create class="pill" :disabled="!canCreate" @click="onCreate">
          {{ status === 'opening' ? t('cloud.creating') : t('cloud.create') }}
        </button>
        <button type="button" class="pill pill--ghost" @click="mode = 'open'">{{ t('cloud.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cloud-panel {
  background: var(--bg-panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 20px;
}

.cloud-panel__form,
.cloud-panel__done {
  display: grid;
  gap: 12px;
}

.cloud-panel__lead {
  margin: 0;
}

.cloud-panel__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.cloud-panel__hint {
  margin: 0;
  color: var(--fg-muted);
  font-size: 13px;
}

.cloud-panel__warn {
  margin: 0;
  color: var(--accent);
  font-size: 13px;
}

.cloud-panel__check {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
}

.cloud-panel__code {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
  word-break: break-all;
}

.cloud-panel__code--big {
  font-size: 20px;
  letter-spacing: 0.02em;
}

.field {
  flex: 1;
  min-width: 220px;
  font: inherit;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 10px 12px;
}

.pill {
  background: var(--fg);
  color: var(--bg-panel);
  border: 1px solid var(--fg);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pill--ghost {
  background: transparent;
  color: var(--fg);
  border-color: var(--line-strong);
}

.pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
