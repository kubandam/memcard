<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ files: [files: File[]] }>()
const { t } = useI18n()
const dragging = ref(false)
const input = ref<HTMLInputElement | null>(null)

const ACCEPT = '.chd,.pbp,.iso,.img,.bin,.cue,.m3u,.zip,.7z'

function onChange(e: Event) {
  const el = e.target as HTMLInputElement
  const files = Array.from(el.files ?? [])
  if (files.length) emit('files', files)
  el.value = ''
}

async function onDrop(e: DragEvent) {
  dragging.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const files = await collectFiles(dt)
  if (files.length) emit('files', files)
}

/** Reads dropped files, descending into dropped folders where the browser supports it. */
async function collectFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? [])
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (entries.length === 0) return Array.from(dt.files ?? [])
  const out: File[] = []
  for (const entry of entries) await walk(entry, out)
  return out
}

function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) => (entry as FileSystemFileEntry).file((f) => (out.push(f), resolve()), () => resolve()))
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    return new Promise((resolve) => {
      const readBatch = () =>
        reader.readEntries(async (batch) => {
          if (batch.length === 0) return resolve()
          for (const child of batch) await walk(child, out)
          readBatch()
        }, () => resolve())
      readBatch()
    })
  }
  return Promise.resolve()
}
</script>

<template>
  <div
    data-dropzone
    class="drop-zone"
    :class="{ 'drop-zone--active': dragging }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <p class="label drop-zone__title">{{ t('drop.title') }}</p>
    <p class="drop-zone__hint">{{ t('drop.hint') }}</p>
    <button type="button" class="drop-zone__button label" @click="input?.click()">{{ t('drop.button') }}</button>
    <p class="label drop-zone__privacy">{{ t('drop.privacy') }}</p>
    <input ref="input" type="file" multiple :accept="ACCEPT" class="visually-hidden" @change="onChange" />
  </div>
</template>

<style scoped>
.drop-zone {
  margin-top: 24px;
  padding: 28px 20px;
  text-align: center;
  background: var(--bg-panel);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  transition: border-color 120ms ease;
}

.drop-zone--active {
  border-color: var(--fg);
  border-style: solid;
}

.drop-zone__title {
  margin: 0 0 6px;
  color: var(--fg);
}

.drop-zone__hint {
  margin: 0 0 16px;
  color: var(--fg-muted);
  font-size: 13px;
}

.drop-zone__button {
  background: var(--fg);
  color: var(--bg-panel);
  border: 0;
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  font-weight: 600;
}

.drop-zone__privacy {
  margin: 14px 0 0;
}

@media (max-width: 640px) {
  .drop-zone {
    padding: 18px 16px;
  }

  .drop-zone__hint {
    display: none;
  }
}
</style>
