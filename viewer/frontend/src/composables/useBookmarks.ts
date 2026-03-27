import { ref, watchEffect } from 'vue'
import { fetchBookmarks } from '../api'
import type { BookmarkItem } from '../api'

/** localStorage のキー定数 */
const LS_SORT_BY = 'bookmark-sort-by'
const LS_SORT_ORDER = 'bookmark-sort-order'

/**
 * ブックマーク一覧の取得・無限スクロール・フィルタリングを管理する composable。
 * フィルタ変更時はリストをリセットし、`loadMore` で追加取得する。
 */
export function useBookmarks() {
  const page = ref(1)
  const limit = ref(20)
  const selectedAccount = ref<string | null>(null)
  const selectedCategory = ref<number | null>(null)
  const selectedTag = ref<string | null>(null)
  const searchQuery = ref('')

  /** ソートキー（localStorage から復元） */
  const rawSortBy = localStorage.getItem(LS_SORT_BY)
  const sortBy = ref<'bookmarked_at' | 'created_at'>(
    rawSortBy === 'created_at' ? 'created_at' : 'bookmarked_at'
  )

  /** ソート順（localStorage から復元） */
  const rawSortOrder = localStorage.getItem(LS_SORT_ORDER)
  const sortOrder = ref<'desc' | 'asc'>(rawSortOrder === 'asc' ? 'asc' : 'desc')

  /** 蓄積されたブックマーク一覧（無限スクロールで追記） */
  const items = ref<BookmarkItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** まだ読み込めるページが残っているか */
  const hasMore = ref(true)

  /**
   * 現在のフィルタ条件からリクエストパラメータを生成する。
   * この関数内でリアクティブ値を読み取ることで watchEffect の追跡対象に含める。
   * @param targetPage - 取得するページ番号
   * @returns fetchBookmarks に渡すパラメータオブジェクト
   */
  function buildParams(targetPage: number) {
    return {
      page: targetPage,
      limit: limit.value,
      sort: sortOrder.value,
      sortBy: sortBy.value,
      ...(searchQuery.value ? { q: searchQuery.value } : {}),
      ...(selectedAccount.value ? { account: selectedAccount.value } : {}),
      ...(selectedCategory.value === null
        ? {}
        : { category: selectedCategory.value }),
      ...(selectedTag.value ? { tag: selectedTag.value } : {}),
    }
  }

  /** フィルタ変更を監視し、変更時にページをリセットして再取得する */
  watchEffect((onCleanup) => {
    // buildParams でリアクティブ値を同期的に読み取り、変更検知を登録する
    const params = buildParams(1)

    // フィルタ変更時に古いレスポンスが state を上書きするレース条件を防ぐため、
    // クリーンアップ時にキャンセルフラグを立てる
    const cancel = { value: false }
    onCleanup(() => {
      cancel.value = true
    })

    page.value = 1
    hasMore.value = true
    loading.value = true
    error.value = null

    fetchBookmarks(params)
      .then((res) => {
        if (cancel.value) return
        items.value = res.items
        total.value = res.total
        hasMore.value = items.value.length < res.total
      })
      .catch((error_: unknown) => {
        if (cancel.value) return
        error.value = error_ instanceof Error ? error_.message : 'Unknown error'
      })
      .finally(() => {
        if (!cancel.value) loading.value = false
      })
  })

  /** 次のページを追加で読み込む（無限スクロール用） */
  function loadMore() {
    if (loading.value || !hasMore.value) return
    const nextPage = page.value + 1
    page.value = nextPage

    loading.value = true

    const params = buildParams(nextPage)
    fetchBookmarks(params)
      .then((res) => {
        items.value = [...items.value, ...res.items]
        total.value = res.total
        hasMore.value = items.value.length < res.total
      })
      .catch((error_: unknown) => {
        error.value = error_ instanceof Error ? error_.message : 'Unknown error'
      })
      .finally(() => {
        loading.value = false
      })
  }

  /** ソート順を切り替える（desc ⇔ asc） */
  function toggleSortOrder() {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  }

  /**
   * ソートキーを変更する。
   * watchEffect がフィルタ変更を検知してリストをリセット・再取得する。
   * @param val - 新しいソートキー
   */
  function setSortBy(val: 'bookmarked_at' | 'created_at') {
    sortBy.value = val
    localStorage.setItem(LS_SORT_BY, val)
  }

  /**
   * ソート順を変更する。
   * watchEffect がフィルタ変更を検知してリストをリセット・再取得する。
   * @param val - 新しいソート順
   */
  function setSortOrder(val: 'asc' | 'desc') {
    sortOrder.value = val
    localStorage.setItem(LS_SORT_ORDER, val)
  }

  return {
    page,
    limit,
    selectedAccount,
    selectedCategory,
    selectedTag,
    searchQuery,
    sortBy,
    sortOrder,
    items,
    total,
    loading,
    error,
    hasMore,
    loadMore,
    toggleSortOrder,
    setSortBy,
    setSortOrder,
  }
}
