<script setup lang="ts">
definePageMeta({ layout: 'shelf' })
const { t } = useI18n()
const { siteName, sourceUrl } = useAppConfig()
useHead({ title: t('about.title') })
</script>

<template>
  <article class="about">
    <h1 class="display about__title">{{ t('about.title') }}</h1>

    <SectionLabel>{{ t('about.whatTitle') }}</SectionLabel>
    <p>{{ t('about.what', { site: siteName }) }}</p>

    <SectionLabel>{{ t('about.rulesTitle') }}</SectionLabel>
    <ul class="about__list">
      <li>{{ t('about.rule1') }}</li>
      <li>{{ t('about.rule2') }}</li>
      <li>{{ t('about.rule3') }}</li>
      <li>{{ t('about.rule4') }}</li>
    </ul>

    <SectionLabel>{{ t('about.licencesTitle') }}</SectionLabel>
    <ul class="about__list">
      <li>{{ t('about.licence1') }}</li>
      <li>{{ t('about.licence2') }}</li>
      <li>{{ t('about.licence3') }}</li>
    </ul>

    <SectionLabel>{{ t('about.sourceTitle') }}</SectionLabel>
    <p><a :href="sourceUrl" rel="noopener">{{ sourceUrl }}</a></p>
  </article>
</template>

<style scoped>
.about {
  max-width: 720px;
}

.about__title {
  font-size: 40px;
  margin: 40px 0 0;
}

.about__list {
  padding-left: 20px;
}

.about__list li + li {
  margin-top: 8px;
}
</style>
