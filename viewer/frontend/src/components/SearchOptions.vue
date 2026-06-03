<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { SearchInGroup } from '../api'
import { ALL_SEARCH_GROUPS } from '../api'

const properties = defineProps<{
  /** 現在有効な検索対象グループ */
  modelValue: SearchInGroup[]
}>()

const emit = defineEmits<{
  /** 検索対象グループが変更された */
  'update:modelValue': [groups: SearchInGroup[]]
}>()

/** グループ名とラベルのマッピング */
const GROUP_LABELS: Record<SearchInGroup, string> = {
  text: 'ツイート本文',
  card: 'カード情報',
  url: 'リンク先 URL',
  author: '投稿者名',
  quoted: '引用ツイート',
}

/** ドロップダウンの開閉状態 */
const open = ref(false)
/** ドロップダウンのルート要素（クリックアウト判定用） */
const root = ref<HTMLElement | null>(null)

/**
 * グループのチェック状態を切り替える。
 * 全グループが OFF になる操作は無視する。
 * @param group - 切り替え対象のグループ
 */
function toggle(group: SearchInGroup) {
  const current = properties.modelValue
  const next = current.includes(group)
    ? current.filter((g) => g !== group)
    : [...current, group]
  if (next.length === 0) return
  emit('update:modelValue', next)
}

/**
 * ドロップダウン外クリック時に閉じる。
 * @param event - マウスイベント
 */
function onClickOutside(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside)
})

/** 全グループが有効かどうか */
const isAllActive = () =>
  ALL_SEARCH_GROUPS.every((g) => properties.modelValue.includes(g))
</script>

<template>
  <div ref="root" class="search-options">
    <button
      class="options-btn"
      :class="{ active: !isAllActive(), open }"
      :title="open ? '検索対象を閉じる' : '検索対象を絞り込む'"
      :aria-expanded="open"
      @click="open = !open">
      <!-- スライダーアイコン（検索対象の絞り込みを表す） -->
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round">
        <line x1="2" y1="4" x2="14" y2="4" />
        <line x1="2" y1="8" x2="14" y2="8" />
        <line x1="2" y1="12" x2="14" y2="12" />
        <circle cx="5" cy="4" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="7" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
      <span class="options-label">検索範囲</span>
    </button>

    <div v-if="open" class="dropdown" role="group" aria-label="検索対象">
      <label v-for="group in ALL_SEARCH_GROUPS" :key="group" class="option-row">
        <input
          type="checkbox"
          :checked="modelValue.includes(group)"
          @change="toggle(group)" />
        <span class="option-label">{{ GROUP_LABELS[group] }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.search-options {
  position: relative;
  flex-shrink: 0;
}

.options-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color 0.2s,
    color 0.2s,
    background 0.2s;
}

.options-label {
  font-size: 13px;
}

.options-btn:hover,
.options-btn.open {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* 一部グループが無効の場合はアクセント色で強調 */
.options-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: rgba(29, 155, 240, 0.1);
}

.dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
  min-width: 160px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 8px 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.option-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.option-row:hover {
  background: rgba(239, 243, 244, 0.08);
}

.option-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-accent);
  cursor: pointer;
  flex-shrink: 0;
}

.option-label {
  font-size: 14px;
  color: var(--color-text-primary);
  user-select: none;
}
</style>
