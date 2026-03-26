<script setup lang="ts">
import type { AccountInfo } from '../api'

const props = defineProps<{
  /** アカウント一覧 */
  accounts: AccountInfo[]
  /** 現在選択中のアカウント（null は「すべて」） */
  selected: string | null
}>()

const emit = defineEmits<{
  /** アカウント選択変更 */
  'update:selected': [value: string | null]
}>()

/**
 * アカウント選択を切り替える
 * @param username - 選択するアカウント名（null は「すべて」）
 */
function select(username: string | null) {
  emit('update:selected', username)
}
</script>

<template>
  <div class="account-filter">
    <h3 class="filter-title">アカウント</h3>
    <ul class="account-list">
      <li
        class="account-item"
        :class="{ active: props.selected === null }"
        @click="select(null)">
        <span class="account-name">すべて</span>
      </li>
      <li
        v-for="account in props.accounts"
        :key="account.username"
        class="account-item"
        :class="{ active: props.selected === account.username }"
        @click="select(account.username)">
        <span class="account-name">@{{ account.username }}</span>
        <span class="account-badge">{{ account.bookmarkCount }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.account-filter {
  padding: 12px 0;
}

.filter-title {
  font-size: 20px;
  font-weight: 800;
  padding: 0 16px 12px;
  color: var(--color-text-primary);
}

.account-list {
  list-style: none;
}

.account-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.account-item:hover {
  background: var(--color-bg-hover);
}

.account-item.active {
  background: var(--color-bg-secondary);
}

.account-name {
  color: var(--color-text-primary);
  font-size: 15px;
}

.account-badge {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 9999px;
  min-width: 20px;
  text-align: center;
}

.account-item.active .account-badge {
  background: var(--color-accent);
  color: #fff;
}
</style>
