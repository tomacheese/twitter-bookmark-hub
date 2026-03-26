/** API のベース URL */
const BASE = '/api'

/** リンクカード情報（OGP 相当） */
export interface CardInfo {
  /** カード種別 */
  cardType: 'summary' | 'summary_large_image'
  /** カードのリンク URL */
  cardUrl: string
  /** 表示用ドメイン */
  vanityUrl: string
  /** カードタイトル */
  title: string
  /** カード説明文 */
  description: string
  /** サムネイル画像 URL（存在しない場合は null） */
  thumbnailUrl: string | null
}

/** メディアアイテム（写真・動画・GIF） */
export interface MediaItem {
  /** メディア種別 */
  type: 'photo' | 'video' | 'animated_gif'
  /** サムネイル画像 URL */
  thumbUrl: string
  /** 動画 URL（video / animated_gif の場合のみ） */
  videoUrl?: string
}

/** URL エンティティ（t.co → 展開 URL のマッピング） */
export interface UrlEntity {
  /** t.co 短縮 URL */
  url: string
  /** 展開後の URL */
  expandedUrl: string
  /** 表示用 URL */
  displayUrl: string
}

/** 引用ツイート情報 */
export interface QuotedTweet {
  /** ツイート ID */
  tweetId: string
  /** ツイート本文 */
  fullText: string
  /** スクリーンネーム（@除く） */
  screenName: string
  /** 表示名 */
  userName: string
  /** プロフィール画像 URL（存在しない場合は null） */
  profileImageUrl: string | null
  /** メディアアイテム一覧 */
  mediaItems: MediaItem[]
  /** URL エンティティ一覧 */
  urlEntities: UrlEntity[]
}

/** ブックマークアイテム */
export interface BookmarkItem {
  /** ツイート ID */
  tweetId: string
  /** ツイート本文 */
  fullText: string
  /** スクリーンネーム（@除く） */
  screenName: string
  /** 表示名 */
  userName: string
  /** プロフィール画像 URL（存在しない場合は null） */
  profileImageUrl: string | null
  /** ツイート投稿日時（ISO 8601） */
  createdAt: string
  /** ブックマーク登録日時（ISO 8601） */
  bookmarkedAt: string
  /** ツイートの URL */
  tweetUrl: string
  /** メディアアイテム一覧 */
  mediaItems: MediaItem[]
  /** このツイートをブックマークしているアカウントのユーザー名一覧 */
  bookmarkedBy: string[]
  /** URL エンティティ一覧 */
  urlEntities: UrlEntity[]
  /** 引用ツイート情報（存在しない場合は null） */
  quotedTweet: QuotedTweet | null
  /** 動画プレーヤーカードの URL（存在しない場合は null） */
  cardPlayerUrl: string | null
  /** リンクカード情報（存在しない場合は null） */
  cardInfo: CardInfo | null
}

/** ブックマーク一覧レスポンス */
export interface BookmarksResponse {
  /** ブックマークアイテム一覧 */
  items: BookmarkItem[]
  /** 総件数 */
  total: number
  /** 現在のページ番号 */
  page: number
  /** 1 ページあたりの件数 */
  limit: number
}

/** アカウント情報 */
export interface AccountInfo {
  /** ユーザー名（@除く） */
  username: string
  /** ブックマーク件数 */
  bookmarkCount: number
}

/** クロールジョブのステータス */
export interface CrawlJobStatus {
  /** ジョブ ID */
  id: number
  /** 開始日時（ISO 8601） */
  startedAt: string
  /** 終了日時（ISO 8601）。実行中は null */
  finishedAt: string | null
  /** ジョブのステータス */
  status: 'running' | 'success' | 'error'
  /** エラーメッセージ（エラー時のみ） */
  errorMessage: string | null
  /** 処理対象アカウント数 */
  accountsTotal: number | null
  /** 成功したアカウント数 */
  accountsSucceeded: number | null
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
