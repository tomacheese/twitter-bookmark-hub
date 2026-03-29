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
  FeaturesResponse,
  CategoryItem,
  TagItem,
} from '@twitter-bookmark-hub/shared'

/** API のベース URL */
const BASE = '/api'

/**
 * 非 2xx レスポンスのエラー詳細を取得してエラーをスローする。
 * Content-Type に応じて JSON 本文またはテキスト本文からメッセージを抽出する。
 * @param res - fetch レスポンス
 * @param prefix - エラーメッセージのプレフィックス
 */
async function throwResponseError(
  res: Response,
  prefix: string
): Promise<never> {
  const contentType = res.headers.get('content-type') ?? ''
  let detail: string
  try {
    if (contentType.includes('application/json')) {
      const body = (await res.json()) as Record<string, unknown>
      const msg = body.error ?? body.message
      detail = typeof msg === 'string' ? msg : JSON.stringify(body)
    } else {
      detail = (await res.text()) || String(res.status)
    }
  } catch {
    detail = String(res.status)
  }
  throw new Error(`${prefix}: ${detail}`)
}

/**
 * ブックマーク一覧を取得する
 * @param params - 検索パラメータ
 * @returns ブックマークレスポンス
 */
export async function fetchBookmarks(params: {
  page?: number
  limit?: number
  q?: string
  account?: string
  sort?: 'asc' | 'desc'
  sortBy?: 'bookmarked_at' | 'created_at'
  category?: number
  /** タグ名でフィルタ（完全一致） */
  tag?: string
}): Promise<BookmarksResponse> {
  const query = new URLSearchParams()
  if (params.page != null) query.set('page', String(params.page))
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.q) query.set('q', params.q)
  if (params.account) query.set('account', params.account)
  if (params.sort) query.set('sort', params.sort)
  if (params.sortBy) query.set('sort_by', params.sortBy)
  if (params.category != null) query.set('category', String(params.category))
  if (params.tag) query.set('tag', params.tag)

  const res = await fetch(`${BASE}/bookmarks?${query.toString()}`)
  if (!res.ok) return throwResponseError(res, 'Failed to fetch bookmarks')
  return res.json() as Promise<BookmarksResponse>
}

/**
 * アカウント一覧を取得する
 * @returns アカウント情報の配列
 */
export async function fetchAccounts(): Promise<AccountInfo[]> {
  const res = await fetch(`${BASE}/accounts`)
  if (!res.ok) return throwResponseError(res, 'Failed to fetch accounts')
  return res.json() as Promise<AccountInfo[]>
}

/**
 * 最新のクロールステータスを取得する
 * @returns クロールジョブステータス（存在しない場合は null）
 */
export async function fetchCrawlStatus(): Promise<CrawlJobStatus | null> {
  const res = await fetch(`${BASE}/crawl/status`)
  if (!res.ok) return throwResponseError(res, 'Failed to fetch crawl status')
  return res.json() as Promise<CrawlJobStatus | null>
}

/**
 * クロールを手動で開始する
 * @returns レスポンスオブジェクト
 */
export async function triggerCrawl(): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/crawl/trigger`, { method: 'POST' })
  if (!res.ok) return throwResponseError(res, 'Failed to trigger crawl')
  return res.json() as Promise<{ message: string }>
}

/**
 * 有効な機能フラグを取得する
 * @returns 機能フラグ
 */
export async function fetchFeatures(): Promise<FeaturesResponse> {
  const res = await fetch(`${BASE}/features`)
  if (!res.ok) return throwResponseError(res, 'Failed to fetch features')
  return res.json() as Promise<FeaturesResponse>
}

/**
 * カテゴリ一覧を取得する
 * @returns カテゴリアイテムの配列
 */
export async function fetchCategories(): Promise<CategoryItem[]> {
  const res = await fetch(`${BASE}/categories`)
  if (!res.ok) return throwResponseError(res, 'Failed to fetch categories')
  return res.json() as Promise<CategoryItem[]>
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
  const res = await fetch(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return throwResponseError(res, 'Failed to create category')
  return res.json() as Promise<CategoryItem>
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
  const res = await fetch(`${BASE}/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return throwResponseError(res, 'Failed to update category')
  return res.json() as Promise<CategoryItem>
}

/**
 * カテゴリを削除する
 * @param id - カテゴリ ID
 */
export async function deleteCategory(id: number): Promise<void> {
  const res = await fetch(`${BASE}/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) return throwResponseError(res, 'Failed to delete category')
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
  const res = await fetch(
    `${BASE}/bookmarks/${encodeURIComponent(tweetId)}?${query.toString()}`,
    { method: 'DELETE' }
  )
  if (!res.ok) return throwResponseError(res, 'Failed to delete bookmark')
}

/**
 * 頻出タグ一覧を取得する
 * @param limit - 上限件数（デフォルト 50）
 * @returns タグアイテムの配列
 */
export async function fetchTags(limit = 50): Promise<TagItem[]> {
  const res = await fetch(`${BASE}/tags?limit=${limit}`)
  if (!res.ok) return throwResponseError(res, 'Failed to fetch tags')
  return res.json() as Promise<TagItem[]>
}
