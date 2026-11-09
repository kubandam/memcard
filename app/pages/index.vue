<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { LocalGame } from '~~/shared/types/game'

definePageMeta({ layout: 'shelf' })
const { t } = useI18n()
const { siteName } = useAppConfig()
useHead({ title: t('home.title') })

// Free games arrive with the M2 manifest; the section is hidden while empty.
const freeGames = ref<LocalGame[]>([])

const { games, notice, storage, sessionGame, refresh, addFiles, rename, remove } = useLocalLibrary()

const renaming = ref<string | null>(null)
const renameValue = ref('')
const confirmingDelete = ref<string | null>(null)

onMounted(refresh)

function startRename(game: LocalGame) {
  renaming.value = game.id
  renameValue.value = game.title
}

async function commitRename() {
  if (!renaming.value) return
  await rename(renaming.value, renameValue.value)
  renaming.value = null
}

async function confirmDelete(id: string) {
  if (confirmingDelete.value !== id) {
    confirmingDelete.value = id
    return
  }
  confirmingDelete.value = null
  await remove(id)
}
</script>

<template>
  <div>
    <h1 class="visually-hidden">{{ siteName }}</h1>

    <section v-if="freeGames.length" aria-labelledby="free-games">
      <SectionLabel><span id="free-games">{{ t('home.freeGames') }}</span></SectionLabel>
      <GameGrid>
        <GameTile v-for="game in freeGames" :key="game.id" :game="game" :href="`/play/free/${game.id}`" />
      </GameGrid>
    </section>

    <section aria-labelledby="my-games">
      <SectionLabel>
        <span id="my-games">{{ t('home.myGames') }}</span>
        <template #meta>{{ t('home.storedLocally') }}</template>
      </SectionLabel>

      <Notice v-if="notice" :kind="notice.kind">
        {{ t(notice.key, notice.params ?? {}) }}
        <a v-if="notice.key === 'errors.quota' && sessionGame" href="/play/session/current" class="notice-link">{{ t('home.playAnyway') }}</a>
      </Notice>

      <GameGrid v-if="games.length">
        <GameTile v-for="game in games" :key="game.id" :game="game" :href="`/play/local/${game.id}`">
          <template #actions>
            <template v-if="renaming === game.id">
              <input v-model="renameValue" class="rename-input" :aria-label="t('home.renameLabel')" @keyup.enter="commitRename" @keyup.escape="renaming = null" />
              <button type="button" class="link-button label" @click="commitRename">{{ t('home.save') }}</button>
            </template>
            <template v-else>
              <button type="button" class="link-button label" @click="startRename(game)">{{ t('home.rename') }}</button>
              <button type="button" class="link-button label" :class="{ 'link-button--danger': confirmingDelete === game.id }" @click="confirmDelete(game.id)">
                {{ confirmingDelete === game.id ? t('home.confirmDelete') : t('home.delete') }}
              </button>
            </template>
          </template>
        </GameTile>
      </GameGrid>
      <p v-else class="empty">{{ t('home.empty') }}</p>

      <StorageMeter v-if="storage" :usage="storage.usage" :quota="storage.quota" />

      <DropZone @files="addFiles" />
    </section>
  </div>
</template>

<style scoped>
.empty {
  color: var(--fg-muted);
  margin: 0;
}

.link-button {
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link-button--danger {
  color: var(--accent);
}

.rename-input {
  font: inherit;
  font-size: 12px;
  background: var(--bg-panel);
  color: var(--fg);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 2px 6px;
  min-width: 0;
  flex: 1;
}

.notice-link {
  margin-left: 8px;
}
</style>
