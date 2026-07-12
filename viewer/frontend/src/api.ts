import type {
  BookmarksResponse,
  AccountInfo,
  CrawlJobStatus,
  FeaturesResponse,
  CategoryItem,
  TagItem,
} from '@twitter-bookmark-hub/shared'

export type {
  CardInfo,
  MediaItem,
  UrlEntity,
  QuotedTweet,
  BookmarkItem,
  BookmarksResponse,
  AccountInfo,
  CrawlJobStatus,
  CrawlAccountResult,
  FeaturesResponse,
  CategoryItem,
  TagItem,
} from '@twitter-bookmark-hub/shared'

/** API のベース URL */
const BASE = '/api'

/**
 * 非 2xx レスポンスのエラー詳細を取得してエラーをスローする。
 * Content-Type に応じて JSON 本文またはテキスト本文からメッセージを抽出する。
 * @param response - fetch レスポンス
 * @param prefix - エラーメッセージのプレフィックス
 */
async function throwResponseError(
  response: Response,
  prefix: string
): Promise<never> {
  const contentType = response.headers.get('content-type') ?? ''
  let detail: string
  try {
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as Record<string, unknown>
      const message = body.error ?? body.message
      detail = typeof message === 'string' ? message : JSON.stringify(body)
    } else {
      detail = (await response.text()) || String(response.status)
    }
  } catch {
    detail = String(response.status)
  }
  throw new Error(`${prefix}: ${detail}`)
}

/**
 * 検索対象グループ。
 * backend の SearchInGroup と同一の値セット。
 */
export type SearchInGroup = 'text' | 'card' | 'url' | 'author' | 'quoted'

/** 全検索対象グループ */
export const ALL_SEARCH_GROUPS: SearchInGroup[] = [
  'text',
  'card',
  'url',
  'author',
  'quoted',
]

/**
 * ブックマーク一覧を取得する
 * @param parameters - 検索パラメータ
 * @returns ブックマークレスポンス
 */
export async function fetchBookmarks(parameters: {
  page?: number
  limit?: number
  q?: string
  /** 検索対象グループ（省略時は全グループ） */
  searchIn?: SearchInGroup[]
  account?: string
  sort?: 'asc' | 'desc'
  sortBy?: 'bookmarked_at' | 'created_at'
  category?: number
  /** タグ名でフィルタ（完全一致） */
  tag?: string
}): Promise<BookmarksResponse> {
  const query = new URLSearchParams()
  if (parameters.page != null) query.set('page', String(parameters.page))
  if (parameters.limit != null) query.set('limit', String(parameters.limit))
  if (parameters.q) query.set('q', parameters.q)
  if (parameters.searchIn && parameters.searchIn.length > 0) {
    query.set('search_in', parameters.searchIn.join(','))
  }
  if (parameters.account) query.set('account', parameters.account)
  if (parameters.sort) query.set('sort', parameters.sort)
  if (parameters.sortBy) query.set('sort_by', parameters.sortBy)
  if (parameters.category != null)
    query.set('category', String(parameters.category))
  if (parameters.tag) query.set('tag', parameters.tag)

  const response = await fetch(`${BASE}/bookmarks?${query.toString()}`)
  if (!response.ok)
    return throwResponseError(response, 'Failed to fetch bookmarks')
  return response.json() as Promise<BookmarksResponse>
}

/**
 * アカウント一覧を取得する
 * @returns アカウント情報の配列
 */
export async function fetchAccounts(): Promise<AccountInfo[]> {
  const response = await fetch(`${BASE}/accounts`)
  if (!response.ok)
    return throwResponseError(response, 'Failed to fetch accounts')
  return response.json() as Promise<AccountInfo[]>
}

/**
 * 最新のクロールステータスを取得する
 * @returns クロールジョブステータス（存在しない場合は null）
 */
export async function fetchCrawlStatus(): Promise<CrawlJobStatus | null> {
  const response = await fetch(`${BASE}/crawl/status`)
  if (!response.ok)
    return throwResponseError(response, 'Failed to fetch crawl status')
  return response.json() as Promise<CrawlJobStatus | null>
}

/**
 * クロールを手動で開始する
 * @returns レスポンスオブジェクト
 */
export async function triggerCrawl(): Promise<{ message: string }> {
  const response = await fetch(`${BASE}/crawl/trigger`, { method: 'POST' })
  if (!response.ok)
    return throwResponseError(response, 'Failed to trigger crawl')
  return response.json() as Promise<{ message: string }>
}

/**
 * 有効な機能フラグを取得する
 * @returns 機能フラグ
 */
export async function fetchFeatures(): Promise<FeaturesResponse> {
  const response = await fetch(`${BASE}/features`)
  if (!response.ok)
    return throwResponseError(response, 'Failed to fetch features')
  return response.json() as Promise<FeaturesResponse>
}

/**
 * カテゴリ一覧を取得する
 * @returns カテゴリアイテムの配列
 */
export async function fetchCategories(): Promise<CategoryItem[]> {
  const response = await fetch(`${BASE}/categories`)
  if (!response.ok)
    return throwResponseError(response, 'Failed to fetch categories')
  return response.json() as Promise<CategoryItem[]>
}

/**
 * カテゴリを作成する
 * @param data - カテゴリデータ
 * @returns 作成されたカテゴリ
 */
export async function createCategory(data: {
  name: string
  color: string
  keywords: string[]
}): Promise<CategoryItem> {
  const response = await fetch(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok)
    return throwResponseError(response, 'Failed to create category')
  return response.json() as Promise<CategoryItem>
}

/**
 * カテゴリを更新する
 * @param id - カテゴリ ID
 * @param data - 更新データ
 * @returns 更新されたカテゴリ
 */
export async function updateCategory(
  id: number,
  data: { name: string; color: string; keywords: string[] }
): Promise<CategoryItem> {
  const response = await fetch(`${BASE}/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok)
    return throwResponseError(response, 'Failed to update category')
  return response.json() as Promise<CategoryItem>
}

/**
 * カテゴリを削除する
 * @param id - カテゴリ ID
 */
export async function deleteCategory(id: number): Promise<void> {
  const response = await fetch(`${BASE}/categories/${id}`, { method: 'DELETE' })
  if (!response.ok)
    return throwResponseError(response, 'Failed to delete category')
}

/**
 * ブックマークを解除する。クローラー経由で Twitter 側からも削除する
 * @param tweetId - ツイート ID
 * @param account - 解除対象のアカウント名
 */
export async function deleteBookmark(
  tweetId: string,
  account: string
): Promise<void> {
  const query = new URLSearchParams({ account })
  const response = await fetch(
    `${BASE}/bookmarks/${encodeURIComponent(tweetId)}?${query.toString()}`,
    { method: 'DELETE' }
  )
  if (!response.ok)
    return throwResponseError(response, 'Failed to delete bookmark')
}

/**
 * 頻出タグ一覧を取得する
 * @param limit - 上限件数（デフォルト 50）
 * @returns タグアイテムの配列
 */
export async function fetchTags(limit = 50): Promise<TagItem[]> {
  const response = await fetch(`${BASE}/tags?limit=${limit}`)
  if (!response.ok) return throwResponseError(response, 'Failed to fetch tags')
  return response.json() as Promise<TagItem[]>
}
