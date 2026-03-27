<script setup lang="ts">
import type { BookmarkItem } from '../api'
import BookmarkCard from './BookmarkCard.vue'

defineProps<{
  /** ブックマークアイテム一覧 */
  items: BookmarkItem[]
  /** 読み込み中フラグ */
  loading: boolean
  /** エラーメッセージ */
  error: string | null
  /** 現在のページ */
  page: number
  /** 全件数 */
  total: number
  /** 1 ページあたりの件数 */
  limit: number
}>()

const emit = defineEmits<{
  /** 次のページへ */
  next: []
  /** 前のページへ */
  prev: []
}>()
</script>

<template>
  <div class="bookmark-list">
    <!-- ローディング -->
    <div v-if="loading" class="status-message">読み込み中...</div>

    <!-- エラー -->
    <div v-else-if="error" class="status-message error">{{ error }}</div>

    <!-- 結果なし -->
    <div v-else-if="items.length === 0" class="status-message">
      ブックマークが見つかりません
    </div>

    <!-- カード一覧 -->
    <template v-else>
      <BookmarkCard v-for="item in items" :key="item.tweetId" :item="item" />
    </template>

    <!-- ページネーション -->
    <div v-if="total > 0" class="pagination">
      <button class="page-button" :disabled="page <= 1" @click="emit('prev')">
        ← 前へ
      </button>
      <span class="page-info">
        {{ page }} / {{ Math.ceil(total / limit) }}
      </span>
      <button
        class="page-button"
        :disabled="page * limit >= total"
        @click="emit('next')">
        次へ →
      </button>
    </div>
  </div>
</template>

<style scoped>
.bookmark-list {
  min-height: 200px;
}

.status-message {
  padding: 40px 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 15px;
}

.status-message.error {
  color: #f4212e;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid var(--color-border);
}

.page-button {
  background: transparent;
  color: var(--color-accent);
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 9999px;
  transition: background 0.2s;
}

.page-button:hover:not(:disabled) {
  background: rgba(29, 155, 240, 0.1);
}

.page-button:disabled {
  color: var(--color-text-secondary);
  cursor: not-allowed;
}

.page-info {
  color: var(--color-text-secondary);
  font-size: 14px;
}
</style>
