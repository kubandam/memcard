<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { LocalGame } from '~~/shared/types/game'

definePageMeta({ layout: 'shelf' })
const { t } = useI18n()
const { siteName } = useAppConfig()
useHead({ title: t('home.title') })

const { games: freeGames } = useFreeGames()

const {
  games, saving, notice, storage, sessionGame, coverUrls, coverBusy, bulkBusy, pendingConsentFor, missingCoverCount,
  refresh, addFiles, rename, remove, setCoverFromFile, findCoverOnline, findMissingCovers, decideAutoCovers,
} = useLocalLibrary()

const renaming = ref<string | null>(null)
const renameValue = ref('')
const confirmingDelete = ref<string | null>(null)

const cloud = useCloudLibrary()
/** First-time visitors get the big drop area; once there is a library or local games it is a single row. */
const compactAdd = computed(() => cloud.status.value === 'open' || games.value.length > 0)
const shared = useSharedLibraries()

const hydrated = ref(false)
/**
 * False until a remembered library (and shared ones) had its chance to open. Until then the
 * online library keeps its place with a placeholder and everything below it is invisible: on a
 * slow tablet the free games would otherwise sit where the library appears a few seconds later,
 * and a tap meant for a library game would start a free one.
 */
const settled = ref(false)
/** Never keep the page hidden longer than this, even if the network hangs. */
const SETTLE_MAX_MS = 8000

onMounted(() => {
  hydrated.value = true
  refresh()
  const timeout = new Promise((r) => setTimeout(r, SETTLE_MAX_MS))
  void Promise.race([Promise.allSettled([cloud.restore(), shared.restore()]), timeout]).finally(() => (settled.value = true))
})

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
  <div :data-hydrated="hydrated ? '' : undefined">
    <h1 class="visually-hidden">{{ siteName }}</h1>


    <ClientOnly>
      <ContinueHero v-if="settled && cloud.status.value === 'open'" />
    </ClientOnly>

    <section aria-labelledby="online-library" class="online">
      <div class="library-head">
        <h2 id="online-library" class="display library-head__title">{{ t('cloud.section') }}</h2>
      </div>
      <ClientOnly>
        <div v-if="!settled" class="online__placeholder" data-library-loading aria-busy="true"><span class="label">{{ t('cloud.opening') }}</span></div>
        <CloudLibrary v-else-if="cloud.status.value === 'open'" @downloaded="refresh" />
        <CloudPanel v-else />
        <template #fallback>
          <div class="online__placeholder" aria-busy="true"><span class="label">{{ t('cloud.opening') }}</span></div>
        </template>
      </ClientOnly>
      <ClientOnly>
        <template v-if="!settled" />
        <details v-else-if="cloud.status.value === 'open'" class="redeem-toggle">
          <summary class="label">{{ t('share.haveCodeFromFriend') }}</summary>
          <RedeemCode @downloaded="refresh" />
        </details>
        <div v-else class="redeem-wrap">
          <p class="label">{{ t('share.haveCode') }}</p>
          <RedeemCode @downloaded="refresh" />
        </div>
      </ClientOnly>
    </section>

    <div class="below" :class="{ 'below--waiting': !settled }" :inert="!settled || undefined">
    <FreeGames v-if="freeGames.length" :games="freeGames" @downloaded="refresh" />

    <ClientOnly>
      <SharedLibrary v-for="lib in shared.libraries.value" :key="lib.shareId" :library="lib" @downloaded="refresh" />
    </ClientOnly>

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
      <p v-else-if="!compactAdd" class="empty">{{ t('home.empty') }}</p>

      <StorageMeter v-if="storage && games.length" :usage="storage.usage" :quota="storage.quota" />

      <DropZone :compact="compactAdd" @files="addFiles" />
    </section>
    </div>
  </div>
</template>

<style scoped>
/* Same height as the passphrase form, so the page does not jump when it is replaced. */
.online__placeholder {
  min-height: 320px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
}

.online__placeholder .label {
  opacity: 0;
  animation: placeholder-in 200ms ease 400ms forwards;
}

@keyframes placeholder-in {
  to { opacity: 1; }
}

.below--waiting {
  visibility: hidden;
}

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
  flex-wrap: wrap;
  gap: 6px 18px;
  align-items: baseline;
}

.redeem-toggle {
  margin-top: 24px;
}

.redeem-toggle summary {
  cursor: pointer;
  margin-bottom: 10px;
}

.redeem-wrap {
  margin-top: 20px;
  display: grid;
  gap: 8px;
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
