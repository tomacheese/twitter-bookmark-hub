<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
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
  selectedAccount,
  selectedCategory,
  selectedTag,
  searchQuery,
  sortBy,
  sortOrder,
  items,
  loading,
  error,
  hasMore,
  loadMore,
  toggleSortOrder,
  removeItemAccount,
} = useBookmarks()

const { accounts } = useAccounts()
const { analyzerEnabled } = useFeatures()
const { categories, loadCategories } = useCategories()

/** analyzer が有効になったらカテゴリを取得する（初回のみ、unmount 時に自動解除） */
watch(
  analyzerEnabled,
  (enabled) => {
    if (enabled) {
      loadCategories().catch(() => {})
    }
  },
  { immediate: true }
)

/** サイドバーの開閉状態（初期は閉じた状態） */
const sidebarOpen = ref(false)

/**
 * URL ハッシュからタグパラメータを解析する。
 * 例: `#/?tag=Vue` → `"Vue"`、`#/` → `null`、`#/?tag=` → `null`
 * 空文字は null として扱い、「セット済みだが空」という不整合状態を防ぐ。
 * @returns タグ名、またはタグパラメータがない・空の場合は null
 */
function parseTagFromHash(): string | null {
  const hash = globalThis.location.hash
  const queryStart = hash.indexOf('?')
  if (queryStart === -1) return null
  const tag = new URLSearchParams(hash.slice(queryStart + 1)).get('tag')
  // 空文字は null に正規化する（#/?tag= のような不正な URL への対処）
  return tag === '' ? null : tag
}

/**
 * ハッシュからビュー名を導出するヘルパー。
 * クエリパラメータ（`?` 以降）を除いたパス部分で判定する。
 * @returns 現在のビュー名
 */
function resolveView(): 'main' | 'settings' {
  const hash = globalThis.location.hash
  const path = hash.includes('?') ? hash.slice(0, hash.indexOf('?')) : hash
  return path === '#/settings' ? 'settings' : 'main'
}

/** 現在のビュー（ハッシュルーティング） */
const currentView = ref<'main' | 'settings'>(resolveView())

/**
 * hashchange イベントハンドラ。
 * ブラウザの戻る/進む操作に対応するため、ハッシュからフィルタ状態を復元する。
 * analyzer が無効な場合は `#/settings` でもテンプレートはメイン画面を表示するため、
 * 実際の表示状態（`analyzerEnabled` も考慮）でタグ復元を判断する。
 */
function onHashChange() {
  const newView = resolveView()
  currentView.value = newView
  // analyzer が無効なら settings URL でも実際にはメイン画面を表示している
  const isShowingMain = newView === 'main' || !analyzerEnabled.value
  if (isShowingMain) {
    const tag = parseTagFromHash()
    if (selectedTag.value !== tag) {
      // watchEffect がフィルタ変更を検知してリストをリセット・再取得する
      selectedTag.value = tag
    }
  }
}

onMounted(() => {
  globalThis.addEventListener('hashchange', onHashChange)
  // 初回マウント時にハッシュからタグフィルタを復元する（直リンク対応）。
  // タグをセットすると watchEffect がフィルタ変更を検知して再取得する
  const tag = parseTagFromHash()
  if (tag) {
    selectedTag.value = tag
  }
})

onUnmounted(() => {
  globalThis.removeEventListener('hashchange', onHashChange)
})

/**
 * ビューを切り替える。
 * メインへ戻る際はアクティブなタグフィルタを URL に保持する。
 * @param view - 遷移先ビュー名
 */
function navigateTo(view: 'main' | 'settings') {
  if (view === 'settings') {
    globalThis.location.hash = '#/settings'
  } else {
    // 設定から戻る際、タグフィルタが有効な場合は URL に保持する
    const tag = selectedTag.value
    globalThis.location.hash = tag
      ? '#/?' + new URLSearchParams({ tag }).toString()
      : '#/'
  }
}

/**
 * アカウント選択を更新する。
 * useBookmarks 内の watchEffect がフィルタ変更を検知してリストをリセットする。
 * @param account - 選択されたアカウント名（null は「すべて」）
 */
function onAccountChange(account: string | null) {
  selectedAccount.value = account
}

/**
 * カテゴリ選択を更新する。
 * useBookmarks 内の watchEffect がフィルタ変更を検知してリストをリセットする。
 * @param categoryId - 選択されたカテゴリ ID（null は「すべて」）
 */
function onCategoryChange(categoryId: number | null) {
  selectedCategory.value = categoryId
}

/**
 * タグクリック時の処理。URL ハッシュを更新してブラウザ履歴エントリを作成する。
 * hashchange が発火し、onHashChange が selectedTag・page をセットする。
 * @param tag - クリックされたタグ名
 */
function onTagClick(tag: string) {
  globalThis.location.hash = '#/?' + new URLSearchParams({ tag }).toString()
}

/**
 * タグフィルタをクリアして URL を元に戻す。
 * hashchange が発火し、onHashChange が selectedTag = null をセットする。
 */
function clearTagFilter() {
  globalThis.location.hash = '#/'
}

/**
 * ブックマーク解除完了時に items からアカウントを削除する。
 * @param payload - 解除されたツイート ID とアカウント名
 */
function onBookmarkDeleted(payload: { tweetId: string; account: string }) {
  removeItemAccount(payload.tweetId, payload.account)
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
          <!-- PC: テキスト表示 / スマホ: アイコンのみ表示 -->
          <span class="nav-btn-label">{{
            currentView === 'settings' ? '← 戻る' : '⚙ 設定'
          }}</span>
          <span class="nav-btn-icon" aria-hidden="true">{{
            currentView === 'settings' ? '←' : '⚙'
          }}</span>
        </button>
      </div>
    </header>

    <!-- 設定ページ（analyzer 有効時のみ表示） -->
    <Settings v-if="currentView === 'settings' && analyzerEnabled" />

    <!-- メインページ -->
    <div v-else class="layout">
      <!-- スマホ: サイドバー展開時のオーバーレイ背景 -->
      <div
        v-if="sidebarOpen"
        class="sidebar-overlay"
        aria-hidden="true"
        @click="sidebarOpen = false" />
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
            placeholder="ブックマークを検索" />
          <!-- ソートキー選択 -->
          <select v-model="sortBy" class="sort-select" title="ソート条件">
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

        <!-- アクティブなタグフィルタチップ -->
        <div v-if="selectedTag" class="active-filters">
          <span class="filter-chip">
            🏷 {{ selectedTag }}
            <button
              class="filter-chip-clear"
              title="タグフィルタをクリア"
              @click="clearTagFilter">
              ×
            </button>
          </span>
        </div>

        <BookmarkList
          :items="items"
          :loading="loading"
          :error="error"
          :has-more="hasMore"
          @load-more="loadMore"
          @tag-click="onTagClick"
          @bookmark-deleted="onBookmarkDeleted" />
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

/* PC ではアイコンを非表示にして、スマホではテキストを非表示にする */
.nav-btn-icon {
  display: none;
}

@media (max-width: 768px) {
  .nav-btn-label {
    display: none;
  }

  .nav-btn-icon {
    display: inline;
  }
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

/* アクティブなタグフィルタチップ */
.active-filters {
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  background: rgba(29, 155, 240, 0.15);
  color: var(--color-accent);
  font-size: 13px;
}

.filter-chip-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-accent);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s;
}

.filter-chip-clear:hover {
  background: rgba(29, 155, 240, 0.2);
}

/* レスポンシブ */
@media (max-width: 768px) {
  .layout {
    flex-direction: column;
  }

  /* スマホ: サイドバーを全画面オーバーレイとして表示する */
  .sidebar {
    position: fixed;
    inset: 0;
    top: 53px;
    width: 100% !important;
    height: calc(100vh - 53px) !important;
    z-index: 20;
    border-right: none;
    border-bottom: none;
    overflow-y: auto;
    background: var(--color-bg);
    transition:
      opacity 0.25s ease,
      visibility 0.25s ease;
    visibility: visible;
  }

  .sidebar.sidebar-closed {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    /* width/height はオーバーライドされているため 0 への縮小は不要 */
    width: 100% !important;
    height: calc(100vh - 53px) !important;
    border-bottom-color: transparent;
  }

  /* スマホ: オーバーレイ背景（サイドバーの後ろを暗くする） */
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    top: 53px;
    z-index: 19;
    background: rgba(0, 0, 0, 0.5);
  }

  .main {
    max-width: 100%;
  }
}
</style>
