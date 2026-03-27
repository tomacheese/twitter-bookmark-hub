<script setup lang="ts">
import type { CategoryItem } from '../api'

defineProps<{
  /** カテゴリ一覧 */
  categories: CategoryItem[]
  /** 現在選択中のカテゴリ ID（null は「すべて」） */
  selected: number | null
}>()

const emit = defineEmits<{
  /** カテゴリ選択変更 */
  'update:selected': [value: number | null]
}>()

/**
 * カテゴリ選択を切り替える
 * @param id - 選択するカテゴリ ID（null は「すべて」）
 */
function select(id: number | null) {
  emit('update:selected', id)
}
</script>

<template>
  <div class="category-filter">
    <h3 class="filter-title">カテゴリ</h3>
    <ul class="category-list">
      <li
        class="category-item"
        :class="{ active: selected === null }"
        role="button"
        tabindex="0"
        @click="select(null)"
        @keydown.enter.prevent="select(null)"
        @keydown.space.prevent="select(null)">
        <span class="category-name">すべて</span>
      </li>
      <li
        v-for="category in categories"
        :key="category.id"
        class="category-item"
        :class="{ active: selected === category.id }"
        role="button"
        tabindex="0"
        @click="select(category.id)"
        @keydown.enter.prevent="select(category.id)"
        @keydown.space.prevent="select(category.id)">
        <span class="category-dot" :style="{ background: category.color }" />
        <span class="category-name">{{ category.name }}</span>
        <span class="category-badge">{{ category.bookmarkCount ?? 0 }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.category-filter {
  padding: 12px 0;
}

.filter-title {
  font-size: 20px;
  font-weight: 800;
  padding: 0 16px 12px;
  color: var(--color-text-primary);
}

.category-list {
  list-style: none;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.category-item:hover {
  background: var(--color-bg-hover);
}

.category-item.active {
  background: var(--color-bg-secondary);
}

.category-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.category-name {
  color: var(--color-text-primary);
  font-size: 15px;
  flex: 1;
}

.category-badge {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 9999px;
  min-width: 20px;
  text-align: center;
}

.category-item.active .category-badge {
  background: var(--color-accent);
  color: #fff;
}
</style>
