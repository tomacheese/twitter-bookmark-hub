<script setup lang="ts">
import CategoryManager from '../components/CategoryManager.vue'

/** コンポーネント名を複数語で定義（eslint vue/multi-word-component-names 対応） */
defineOptions({ name: 'SettingsPage' })
</script>

<template>
  <div class="settings-page">
    <CategoryManager />
  </div>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
}
</style>
