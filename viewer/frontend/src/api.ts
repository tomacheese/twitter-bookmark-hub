import type {
  CardInfo,
  MediaItem,
  UrlEntity,
  QuotedTweet,
  BookmarkItem,
  BookmarksResponse,
  AccountInfo,
  CrawlJobStatus,
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
}

/** API のベース URL */
const BASE = '/api'

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
}): Promise<BookmarksResponse> {
  const query = new URLSearchParams()
  if (params.page != null) query.set('page', String(params.page))
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.q) query.set('q', params.q)
  if (params.account) query.set('account', params.account)
  if (params.sort) query.set('sort', params.sort)
  if (params.sortBy) query.set('sort_by', params.sortBy)

  const res = await fetch(`${BASE}/bookmarks?${query.toString()}`)
  if (!res.ok) throw new Error(`Failed to fetch bookmarks: ${res.status}`)
  return res.json() as Promise<BookmarksResponse>
}

/**
 * アカウント一覧を取得する
 * @returns アカウント情報の配列
 */
export async function fetchAccounts(): Promise<AccountInfo[]> {
  const res = await fetch(`${BASE}/accounts`)
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`)
  return res.json() as Promise<AccountInfo[]>
}

/**
 * 最新のクロールステータスを取得する
 * @returns クロールジョブステータス（存在しない場合は null）
 */
export async function fetchCrawlStatus(): Promise<CrawlJobStatus | null> {
  const res = await fetch(`${BASE}/crawl/status`)
  if (!res.ok) throw new Error(`Failed to fetch crawl status: ${res.status}`)
  return res.json() as Promise<CrawlJobStatus | null>
}

/**
 * クロールを手動で開始する
 * @returns レスポンスオブジェクト
 */
export async function triggerCrawl(): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/crawl/trigger`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to trigger crawl: ${res.status}`)
  return res.json() as Promise<{ message: string }>
}
