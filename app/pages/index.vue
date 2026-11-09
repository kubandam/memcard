<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { LocalGame } from '~~/shared/types/game'

definePageMeta({ layout: 'shelf' })
const { t } = useI18n()
const { siteName } = useAppConfig()
useHead({ title: t('home.title') })

// Free games arrive with the M2 manifest; the section is hidden while empty.
const freeGames = ref<LocalGame[]>([])

const {
  games, saving, notice, storage, sessionGame, coverUrls, coverBusy, bulkBusy, pendingConsentFor, missingCoverCount,
  refresh, addFiles, rename, remove, setCoverFromFile, findCoverOnline, findMissingCovers, decideAutoCovers,
} = useLocalLibrary()

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

function onCoverPicked(id: string, e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (file) setCoverFromFile(id, file)
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
      <div class="library-head">
        <h2 id="my-games" class="display library-head__title">{{ t('home.myGames') }}</h2>
        <div class="library-head__meta">
          <button v-if="missingCoverCount > 0" type="button" data-find-all-covers class="link-button label" :title="t('home.findCoverHint')" :disabled="bulkBusy" @click="findMissingCovers">
            {{ bulkBusy ? t('home.findingCover') : t('home.findAllCovers', { n: missingCoverCount }) }}
          </button>
          <span class="label">{{ games.length ? t('home.count', { n: games.length }) : '' }} · {{ t('home.storedLocally') }}</span>
        </div>
      </div>

      <Notice v-if="pendingConsentFor" kind="info" data-auto-covers>
        {{ t('home.autoCoversAsk') }}
        <span class="consent-actions">
          <button type="button" data-accept class="link-button label" @click="decideAutoCovers(true)">{{ t('home.autoCoversYes') }}</button>
          <button type="button" data-decline class="link-button label" @click="decideAutoCovers(false)">{{ t('home.autoCoversNo') }}</button>
        </span>
      </Notice>

      <Notice v-if="notice" :kind="notice.kind">
        {{ t(notice.key, notice.params ?? {}) }}
        <NuxtLink v-if="(notice.key === 'errors.quota' || notice.key === 'errors.unavailable') && sessionGame" to="/play/session/current" class="notice-link">{{ t('home.playAnyway') }}</NuxtLink>
      </Notice>
      <p v-if="saving" data-saving class="label saving" aria-live="polite">{{ t('home.saving') }}</p>

      <GameGrid v-if="games.length">
        <GameTile v-for="game in games" :key="game.id" :game="game" :href="`/play/local/${game.id}`" :cover-url="coverUrls[game.id]">
          <template #actions>
            <template v-if="renaming === game.id">
              <input v-model="renameValue" class="rename-input" :aria-label="t('home.renameLabel')" @keyup.enter="commitRename" @keyup.escape="renaming = null" />
              <button type="button" class="link-button label" @click="commitRename">{{ t('home.save') }}</button>
            </template>
            <template v-else>
              <button type="button" class="link-button label" @click="startRename(game)">{{ t('home.rename') }}</button>
              <label class="link-button label">
                {{ t('home.cover') }}
                <input type="file" accept="image/*" class="visually-hidden" @change="onCoverPicked(game.id, $event)" />
              </label>
              <button type="button" data-find-cover class="link-button label" :title="t('home.findCoverHint')" :disabled="coverBusy === game.id" @click="findCoverOnline(game)">
                {{ coverBusy === game.id ? t('home.findingCover') : t('home.findCover') }}
              </button>
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

.library-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin: 36px 0 20px;
}

.library-head__title {
  margin: 0;
  font-size: 34px;
}

.library-head__meta {
  display: flex;
  gap: 18px;
  align-items: baseline;
}

.consent-actions {
  display: inline-flex;
  gap: 14px;
  margin-left: 12px;
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

.link-button:disabled {
  opacity: 0.5;
  cursor: progress;
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

.saving {
  margin: 8px 0;
}
</style>
