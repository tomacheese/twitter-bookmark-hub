import { ref, watch, watchEffect } from 'vue'
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

  /** sortBy 変更時に localStorage へ保存 */
  watch(sortBy, (val) => {
    localStorage.setItem(LS_SORT_BY, val)
  })
  /** sortOrder 変更時に localStorage へ保存 */
  watch(sortOrder, (val) => {
    localStorage.setItem(LS_SORT_ORDER, val)
  })

  /** 蓄積されたブックマーク一覧（無限スクロールで追記） */
  const items = ref<BookmarkItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** まだ読み込めるページが残っているか */
  const hasMore = ref(true)

  /**
   * フィルタ変更時に `loadMore` の in-flight リクエストを無効化するフラグ。
   * watchEffect の onCleanup で true にセットされ、新しい effect 開始時に false にリセットされる。
   */
  let loadMoreCancelled = false

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
    // クリーンアップ時にキャンセルフラグを立てる。loadMore の in-flight リクエストも同様にキャンセルする
    const cancel = { value: false }
    onCleanup(() => {
      cancel.value = true
      loadMoreCancelled = true
    })

    // 新しいフィルタでの取得開始時に loadMore キャンセルフラグをリセットする
    loadMoreCancelled = false
    page.value = 1
    hasMore.value = true
    loading.value = true
    error.value = null
    // フィルタ変更を検知したタイミングで古いリストと件数をクリアし、
    // UI とフィルタ状態の不整合（旧リストが表示され続ける問題）を防ぐ
    items.value = []
    total.value = 0

    fetchBookmarks(params)
      .then((res) => {
        if (cancel.value) return
        items.value = res.items
        total.value = res.total
        hasMore.value = items.value.length < res.total
      })
      .catch((err: unknown) => {
        if (cancel.value) return
        error.value = err instanceof Error ? err.message : 'Unknown error'
      })
      .finally(() => {
        if (!cancel.value) loading.value = false
      })
  })

  /**
   * 次のページを追加で読み込む（無限スクロール用）。
   * フィルタ変更後に in-flight のリクエストがある場合はキャンセルされる。
   */
  function loadMore() {
    if (loading.value || !hasMore.value) return
    const nextPage = page.value + 1
    // ページ番号はリクエスト成功後に確定させ、失敗時は巻き戻す
    loading.value = true

    const params = buildParams(nextPage)
    fetchBookmarks(params)
      .then((res) => {
        if (loadMoreCancelled) return
        // 成功時のみページ番号を進める
        page.value = nextPage
        items.value = [...items.value, ...res.items]
        total.value = res.total
        hasMore.value = items.value.length < res.total
      })
      .catch((err: unknown) => {
        if (loadMoreCancelled) return
        error.value = err instanceof Error ? err.message : 'Unknown error'
        // 失敗時はページ番号を据え置きにする（次回 loadMore で同ページを再試行できる）
      })
      .finally(() => {
        if (!loadMoreCancelled) loading.value = false
      })
  }

  /** ソート順を切り替える（desc ⇔ asc） */
  function toggleSortOrder() {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
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
  }
}
