import { ref, watch, watchEffect } from 'vue'
import { fetchBookmarks } from '../api'
import type { BookmarkItem } from '../api'

/** localStorage のキー定数 */
const LS_SORT_BY = 'bookmark-sort-by'
const LS_SORT_ORDER = 'bookmark-sort-order'

/**
 * ブックマーク一覧の取得・ページネーション・フィルタリングを管理する composable
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
  const items = ref<BookmarkItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  watchEffect((onCleanup) => {
    // フィルタ変更時に古いレスポンスが state を上書きするレース条件を防ぐため、
    // クリーンアップ時にキャンセルフラグを立てる。
    // オブジェクトプロパティにすることで TypeScript の制御フロー解析による
    // 誤った "always truthy" 警告を回避する
    const cancel = { value: false }
    onCleanup(() => {
      cancel.value = true
    })
    ;(async () => {
      loading.value = true
      error.value = null
      try {
        const params: {
          page: number
          limit: number
          q?: string
          account?: string
          sort?: 'asc' | 'desc'
          sortBy?: 'bookmarked_at' | 'created_at'
          category?: number
          tag?: string
        } = {
          page: page.value,
          limit: limit.value,
          sort: sortOrder.value,
          sortBy: sortBy.value,
        }
        if (searchQuery.value) params.q = searchQuery.value
        if (selectedAccount.value) params.account = selectedAccount.value
        if (selectedCategory.value !== null)
          params.category = selectedCategory.value
        if (selectedTag.value) params.tag = selectedTag.value

        const res = await fetchBookmarks(params)
        if (!cancel.value) {
          items.value = res.items
          total.value = res.total
        }
      } catch (error_) {
        if (!cancel.value) {
          error.value =
            error_ instanceof Error ? error_.message : 'Unknown error'
        }
      } finally {
        if (!cancel.value) {
          loading.value = false
        }
      }
    })().catch((error_: unknown) => {
      if (!cancel.value) {
        error.value = error_ instanceof Error ? error_.message : 'Unknown error'
        loading.value = false
      }
    })
  })

  /** 次のページへ移動 */
  function nextPage() {
    if (page.value * limit.value < total.value) {
      page.value++
    }
  }

  /** 前のページへ移動 */
  function prevPage() {
    if (page.value > 1) {
      page.value--
    }
  }

  /** ソート順を切り替える（desc ⇔ asc）*/
  function toggleSortOrder() {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
    page.value = 1
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
    nextPage,
    prevPage,
    toggleSortOrder,
  }
}
