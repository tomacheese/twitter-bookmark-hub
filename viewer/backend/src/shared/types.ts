import type {
  CardInfo,
  MediaItem,
  UrlEntity,
  QuotedTweet,
} from '@twitter-bookmark-hub/shared'

export type {
  CardInfo,
  MediaItem,
  UrlEntity,
  QuotedTweet,
  CrawlJobStatus,
} from '@twitter-bookmark-hub/shared'

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
