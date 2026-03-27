/** リンクカード情報（OGP 相当） */
export interface CardInfo {
  /** カード種別 */
  cardType: 'summary' | 'summary_large_image'
  /** リンク先 URL */
  cardUrl: string
  /** 表示用ドメイン */
  vanityUrl: string
  /** 記事タイトル */
  title: string
  /** 記事概要 */
  description: string
  /** サムネイル画像 URL */
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
  /** 表示用 URL（ドメイン + パス短縮） */
  displayUrl: string
}

/**
 * 引用ツイート情報。
 * crawler（書き込みモデル）と viewer/backend（読み取りモデル）で共通して使用する。
 */
export interface QuotedTweet {
  /** ツイート ID */
  tweetId: string
  /** ユーザー ID (Twitter Snowflake ID) */
  userId: string
  /** ツイート本文 */
  fullText: string
  /** 投稿日時 (UTC ISO 8601 文字列) */
  createdAt: string
  /** スクリーンネーム */
  screenName: string
  /** 表示名 */
  userName: string
  /** プロフィール画像 URL */
  profileImageUrl: string | null
  /** メディアアイテム一覧 */
  mediaItems: MediaItem[]
  /** URL エンティティ */
  urlEntities: UrlEntity[]
}

/** ブックマーク一覧 API のレスポンスアイテム */
export interface BookmarkItem {
  /** ツイート ID */
  tweetId: string
  /** ツイート本文 */
  fullText: string
  /** スクリーンネーム (@名) */
  screenName: string
  /** ユーザー表示名 */
  userName: string
  /** プロフィール画像 URL */
  profileImageUrl: string | null
  /** ツイート作成日時 */
  createdAt: string
  /** 初回ブックマーク発見日時 */
  bookmarkedAt: string
  /** ツイート URL（screen_name + tweet_id から導出） */
  tweetUrl: string
  /** メディアアイテム一覧（写真・動画・GIF） */
  mediaItems: MediaItem[]
  /** このツイートをブックマークしているアカウント一覧 */
  bookmarkedBy: string[]
  /** URL エンティティ（t.co → 展開 URL） */
  urlEntities: UrlEntity[]
  /** 引用ツイート情報 */
  quotedTweet: QuotedTweet | null
  /** カード動画プレーヤー URL（YouTube 等の embed URL） */
  cardPlayerUrl: string | null
  /** リンクカード情報（OGP 相当） */
  cardInfo: CardInfo | null
}

/** ブックマーク一覧 API のレスポンス */
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
  /** アカウントのユーザー名 */
  username: string
  /** ブックマーク件数 */
  bookmarkCount: number
}

/** クロールジョブのステータス */
export interface CrawlJobStatus {
  /** ジョブ ID */
  id: number
  /** 開始日時 (ISO 8601) */
  startedAt: string
  /** 終了日時 (ISO 8601)。実行中は null */
  finishedAt: string | null
  /** ジョブステータス */
  status: 'running' | 'success' | 'error'
  /** エラーメッセージ（エラー時のみ） */
  errorMessage: string | null
  /** 対象アカウント総数 */
  accountsTotal: number | null
  /** 成功アカウント数 */
  accountsSucceeded: number | null
}
