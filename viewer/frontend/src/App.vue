<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useBookmarks } from './composables/useBookmarks'
import { useAccounts } from './composables/useAccounts'
import { useFeatures } from './composables/useFeatures'
import { useCategories } from './composables/useCategories'
import CrawlStatus from './components/CrawlStatus.vue'
import AccountFilter from './components/AccountFilter.vue'
import CategoryFilter from './components/CategoryFilter.vue'
import BookmarkList from './components/BookmarkList.vue'
import Settings from './views/Settings.vue'

const {
  page,
  limit,
  selectedAccount,
  selectedCategory,
  searchQuery,
  sortBy,
  sortOrder,
  items,
  total,
  loading,
  error,
  nextPage,
  prevPage,
  toggleSortOrder,
} = useBookmarks()

const { accounts } = useAccounts()
const { analyzerEnabled } = useFeatures()
const { categories, loadCategories } = useCategories()

/** analyzer が有効になったらカテゴリを取得する（初回のみ） */
const analyzerWatched = ref(false)
onMounted(() => {
  const interval = setInterval(() => {
    if (analyzerEnabled.value && !analyzerWatched.value) {
      analyzerWatched.value = true
      loadCategories().catch(() => {})
      clearInterval(interval)
    }
  }, 100)
  // 5 秒後にタイムアウト
  setTimeout(() => clearInterval(interval), 5000)
})

/** サイドバーの開閉状態（初期は閉じた状態） */
const sidebarOpen = ref(false)

/**
 * ハッシュからビュー名を導出するヘルパー
 * @returns 現在のビュー名
 */
function resolveView(): 'main' | 'settings' {
  return globalThis.location.hash === '#/settings' ? 'settings' : 'main'
}

/** 現在のビュー（ハッシュルーティング） */
const currentView = ref<'main' | 'settings'>(resolveView())

/** hashchange イベントハンドラ */
function onHashChange() {
  currentView.value = resolveView()
}

onMounted(() => {
  globalThis.addEventListener('hashchange', onHashChange)
})

onUnmounted(() => {
  globalThis.removeEventListener('hashchange', onHashChange)
})

/**
 * ビューを切り替える
 * @param view - 遷移先ビュー名
 */
function navigateTo(view: 'main' | 'settings') {
  globalThis.location.hash = view === 'settings' ? '#/settings' : '#/'
}

/**
 * アカウント選択を更新し、ページを 1 に戻す
 * @param account - 選択されたアカウント名（null は「すべて」）
 */
function onAccountChange(account: string | null) {
  selectedAccount.value = account
  page.value = 1
}

/**
 * カテゴリ選択を更新し、ページを 1 に戻す
 * @param categoryId - 選択されたカテゴリ ID（null は「すべて」）
 */
function onCategoryChange(categoryId: number | null) {
  selectedCategory.value = categoryId
  page.value = 1
}
</script>

<template>
  <div class="app">
    <!-- ヘッダー -->
    <header class="header">
      <div class="header-left">
        <!-- サイドバー開閉ボタン -->
        <button
          class="sidebar-toggle"
          :title="sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'"
          :class="{ 'is-open': sidebarOpen }"
          @click="sidebarOpen = !sidebarOpen">
          <span class="hamburger-line" />
          <span class="hamburger-line" />
          <span class="hamburger-line" />
        </button>
        <h1 class="header-title">
          <a href="#/" class="title-link">Twitter Bookmark Hub</a>
        </h1>
      </div>
      <div class="header-right">
        <CrawlStatus />
        <!-- analyzer が有効な場合のみ設定リンクを表示 -->
        <button
          v-if="analyzerEnabled"
          class="nav-btn"
          :class="{ active: currentView === 'settings' }"
          @click="navigateTo(currentView === 'settings' ? 'main' : 'settings')">
          {{ currentView === 'settings' ? '← 戻る' : '⚙ 設定' }}
        </button>
      </div>
    </header>

    <!-- 設定ページ -->
    <Settings v-if="currentView === 'settings'" />

    <!-- メインページ -->
    <div v-else class="layout">
      <!-- サイドバー -->
      <aside class="sidebar" :class="{ 'sidebar-closed': !sidebarOpen }">
        <AccountFilter
          :accounts="accounts"
          :selected="selectedAccount"
          @update:selected="onAccountChange" />
        <!-- analyzer が有効かつカテゴリがある場合のみ表示 -->
        <CategoryFilter
          v-if="analyzerEnabled && categories.length > 0"
          :categories="categories"
          :selected="selectedCategory"
          @update:selected="onCategoryChange" />
      </aside>

      <!-- メインコンテンツ: サイドバーが閉じていれば横幅いっぱいに広げる -->
      <main class="main" :style="{ maxWidth: sidebarOpen ? '600px' : '100%' }">
        <!-- 検索バー + ソートボタン -->
        <div class="search-bar">
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="ブックマークを検索"
            @input="page = 1" />
          <!-- ソートキー選択 -->
          <select
            v-model="sortBy"
            class="sort-select"
            title="ソート条件"
            @change="page = 1">
            <option value="bookmarked_at">発見日</option>
            <option value="created_at">投稿日</option>
          </select>
          <!-- ソート順トグル -->
          <button
            class="sort-btn"
            :title="
              sortOrder === 'desc'
                ? '新しい順（クリックで古い順に）'
                : '古い順（クリックで新しい順に）'
            "
            @click="toggleSortOrder">
            {{ sortOrder === 'desc' ? '↓ 新' : '↑ 古' }}
          </button>
        </div>

        <BookmarkList
          :items="items"
          :loading="loading"
          :error="error"
          :page="page"
          :total="total"
          :limit="limit"
          @next="nextPage"
          @prev="prevPage" />
      </main>
    </div>
  </div>
</template>

<!-- グローバルスタイル（scoped なし） -->
<style>
:root {
  --color-bg: #000000;
  --color-bg-secondary: #16181c;
  --color-bg-hover: #080808;
  --color-border: #2f3336;
  --color-text-primary: #e7e9ea;
  --color-text-secondary: #71767b;
  --color-accent: #1d9bf0;
  --color-accent-hover: #1a8cd8;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
</style>

<style scoped>
.app {
  min-height: 100vh;
}

.header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  font-size: 20px;
  font-weight: 800;
}

.title-link {
  color: inherit;
  text-decoration: none;
}

.nav-btn {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.nav-btn:hover,
.nav-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* サイドバー開閉ボタン */
/* ハンバーガーボタン */
.sidebar-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s;
}

.sidebar-toggle:hover {
  background: rgba(239, 243, 244, 0.1);
}

.hamburger-line {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--color-text-primary);
  border-radius: 2px;
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
  transform-origin: center;
}

/* 開いた状態: 1・3 本目を × にアニメーション */
.sidebar-toggle.is-open .hamburger-line:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}

.sidebar-toggle.is-open .hamburger-line:nth-child(2) {
  opacity: 0;
  transform: scaleX(0);
}

.sidebar-toggle.is-open .hamburger-line:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

.layout {
  display: flex;
  max-width: 1000px;
  margin: 0 auto;
}

/* サイドバー */
.sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  position: sticky;
  top: 53px;
  height: calc(100vh - 53px);
  overflow-y: auto;
  overflow-x: hidden;
  transition:
    width 0.25s ease,
    opacity 0.25s ease,
    border-color 0.25s ease;
}

.sidebar.sidebar-closed {
  width: 0;
  opacity: 0;
  border-right-color: transparent;
  pointer-events: none;
}

.main {
  flex: 1;
  max-width: 600px;
  border-right: 1px solid var(--color-border);
  min-width: 0;
}

.search-bar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ソートキー選択 */
.sort-select {
  flex-shrink: 0;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.sort-select:hover,
.sort-select:focus {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.sort-select option {
  background: #1a1a1a;
  color: var(--color-text-primary);
}

/* ソートボタン */
.sort-btn {
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 9999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.sort-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.search-input {
  width: 100%;
  background: var(--color-bg-secondary);
  border: 1px solid transparent;
  border-radius: 9999px;
  padding: 10px 16px;
  color: var(--color-text-primary);
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.search-input:focus {
  border-color: var(--color-accent);
  background: transparent;
}

/* レスポンシブ */
@media (max-width: 768px) {
  .layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    position: static;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }

  .sidebar.sidebar-closed {
    width: 100%;
    height: 0;
    border-bottom-color: transparent;
  }

  .main {
    max-width: 100%;
  }
}
</style>
