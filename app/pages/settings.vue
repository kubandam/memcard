<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_KEYS, RETROPAD_PS1_LABELS } from '~/utils/emulatorjs'
import { StorageError, clearAll, deleteBlob, deleteSetting, estimateStorage, getSetting, putBlob, setSetting } from '~/utils/localDb'

definePageMeta({ layout: 'shelf' })
const { t } = useI18n()
useHead({ title: t('settings.title') })

const biosName = ref<string | null>(null)
const storage = ref<{ usage: number; quota: number } | null>(null)
const persisted = ref<boolean | null>(null)
const notice = ref<{ kind: 'error' | 'info'; key: string } | null>(null)
const confirmingClear = ref(false)

const defaultKeys = computed(() =>
  Object.entries(RETROPAD_PS1_LABELS)
    .map(([idx, button]) => ({ button, key: DEFAULT_KEYS[Number(idx)] ?? '' }))
    .filter((row) => row.key),
)

async function load() {
  biosName.value = (await getSetting<string>('biosName')) ?? null
  storage.value = await estimateStorage()
  try {
    persisted.value = (await navigator.storage?.persisted?.()) ?? null
  } catch {
    persisted.value = null
  }
}

onMounted(load)

async function onBiosChange(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file) return
  notice.value = null
  try {
    const previous = await getSetting<string>('bios')
    const key = await putBlob(file)
    await setSetting('bios', key)
    await setSetting('biosName', file.name)
    if (previous) await deleteBlob(previous)
    biosName.value = file.name
    notice.value = { kind: 'info', key: 'settings.biosSaved' }
  } catch (err) {
    notice.value = { kind: 'error', key: err instanceof StorageError && err.code === 'quota' ? 'errors.quota' : 'errors.unavailable' }
  }
  await load()
}

async function removeBios() {
  const key = await getSetting<string>('bios')
  if (key) await deleteBlob(key)
  await deleteSetting('bios')
  await deleteSetting('biosName')
  biosName.value = null
  await load()
}

async function onClear() {
  if (!confirmingClear.value) {
    confirmingClear.value = true
    return
  }
  confirmingClear.value = false
  // The open online library's key also lives in this tab; clearing data must forget it too.
  await useCloudLibrary().close()
  await clearAll()
  notice.value = { kind: 'info', key: 'settings.cleared' }
  await load()
}
</script>

<template>
  <div class="settings">
    <h1 class="display settings__title">{{ t('settings.title') }}</h1>

    <Notice v-if="notice" :kind="notice.kind">{{ t(notice.key) }}</Notice>

    <SectionLabel>{{ t('settings.theme') }}</SectionLabel>
    <ThemeToggle />

    <SectionLabel>{{ t('settings.bios') }}</SectionLabel>
    <p class="settings__text">{{ t('settings.biosOptional') }}</p>
    <p v-if="biosName" class="settings__text">
      {{ t('settings.biosCurrent') }} <strong>{{ biosName }}</strong>
      <button type="button" class="link-button label" @click="removeBios">{{ t('settings.biosRemove') }}</button>
    </p>
    <label class="settings__file label">
      {{ biosName ? t('settings.biosReplace') : t('settings.biosAdd') }}
      <input type="file" accept=".bin" class="visually-hidden" @change="onBiosChange" />
    </label>

    <SectionLabel>{{ t('settings.storage') }}</SectionLabel>
    <StorageMeter v-if="storage" :usage="storage.usage" :quota="storage.quota" />
    <p v-else class="settings__text">{{ t('settings.storageUnknown') }}</p>
    <p v-if="persisted !== null" class="settings__text">{{ persisted ? t('settings.persisted') : t('settings.notPersisted') }}</p>
    <button type="button" data-clear class="settings__danger label" @click="onClear">
      {{ confirmingClear ? t('settings.clearConfirm') : t('settings.clear') }}
    </button>

    <SectionLabel>{{ t('settings.controls') }}</SectionLabel>
    <p class="settings__text">{{ t('controls.remapHint') }} {{ t('controls.gamepadHint') }}</p>
    <table class="settings__table">
      <thead>
        <tr>
          <th class="label">{{ t('controls.button') }}</th>
          <th class="label">{{ t('controls.key') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in defaultKeys" :key="row.button">
          <td>{{ row.button }}</td>
          <td><kbd>{{ row.key }}</kbd></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.settings {
  max-width: 720px;
}

.settings__title {
  font-size: 40px;
  margin: 40px 0 0;
}

.settings__text {
  margin: 0 0 10px;
}

.settings__file {
  display: inline-block;
  padding: 10px 18px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  cursor: pointer;
  color: var(--fg);
}

.settings__danger {
  margin-top: 16px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  margin-left: 10px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.settings__table {
  border-collapse: collapse;
  width: 100%;
  max-width: 420px;
}

.settings__table th {
  text-align: left;
  padding: 0 0 8px;
}

.settings__table td {
  padding: 5px 0;
  border-top: 1px solid var(--line);
}

kbd {
  font-family: inherit;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  padding: 1px 6px;
}
</style>
