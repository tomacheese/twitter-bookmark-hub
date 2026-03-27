<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { BookmarkItem } from '../api'
import BookmarkCard from './BookmarkCard.vue'

const properties = defineProps<{
  /** ブックマークアイテム一覧 */
  items: BookmarkItem[]
  /** 読み込み中フラグ */
  loading: boolean
  /** エラーメッセージ */
  error: string | null
  /** まだ読み込めるページが残っているか */
  hasMore: boolean
}>()

const emit = defineEmits<{
  /** 追加読み込みをリクエスト */
  'load-more': []
  /** タグがクリックされた */
  'tag-click': [tag: string]
}>()

/** センチネル要素（スクロール末端の検知用） */
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

/**
 * センチネル要素が画面内に入ったら load-more イベントを発火する。
 * 読み込み中・これ以上データがない場合は発火しない。
 */
function onIntersect(entries: IntersectionObserverEntry[]) {
  const entry = entries[0]
  if (entry.isIntersecting && !properties.loading && properties.hasMore) {
    emit('load-more')
  }
}

onMounted(() => {
  observer = new IntersectionObserver(onIntersect, {
    // 画面下端から 200px 手前で発火させてスムーズに感じさせる
    rootMargin: '0px 0px 200px 0px',
    threshold: 0,
  })
  if (sentinel.value) {
    observer.observe(sentinel.value)
  }
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="bookmark-list">
    <!-- 初回ローディング（アイテムがまだ空の場合） -->
    <div v-if="loading && items.length === 0" class="status-message">
      読み込み中...
    </div>

    <!-- エラー -->
    <div v-else-if="error && items.length === 0" class="status-message error">
      {{ error }}
    </div>

    <!-- 結果なし -->
    <div v-else-if="!loading && items.length === 0" class="status-message">
      ブックマークが見つかりません
    </div>

    <!-- カード一覧 -->
    <template v-else>
      <BookmarkCard
        v-for="item in items"
        :key="item.tweetId"
        :item="item"
        @tag-click="(tag) => emit('tag-click', tag)" />
    </template>

    <!-- 無限スクロール用センチネル + 追加読み込みインジケータ -->
    <div ref="sentinel" class="scroll-sentinel">
      <div v-if="loading && items.length > 0" class="loading-more">
        読み込み中...
      </div>
      <div v-else-if="!hasMore && items.length > 0" class="end-message">
        すべて表示しました
      </div>
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

.scroll-sentinel {
  height: 1px;
}

.loading-more,
.end-message {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 14px;
}
</style>
