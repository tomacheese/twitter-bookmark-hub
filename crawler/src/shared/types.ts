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
} from '@twitter-bookmark-hub/shared'

/** config.json のアカウント情報 */
export interface AccountConfig {
  /** メールアドレス */
  email: string
  /** ユーザー名 */
  username: string
  /** パスワード */
  password: string
  /** OTP シークレット (2FA 用、任意) */
  otp_secret?: string | null
}

/** config.json 全体の構造 */
export interface AppConfig {
  /** Twitter 関連設定 */
  twitter: {
    /** アカウント一覧 */
    accounts: AccountConfig[]
    /**
     * Twitter API クライアントの言語コード (BCP47)。
     * x-twitter-client-language ヘッダーとして送信され、
     * API レスポンスの言語（Grok 翻訳先言語を含む）に影響する。
     * 省略時は 'ja'。
     */
    clientLanguage?: string
  }
}

/** ローカルに保存する Cookie キャッシュ */
export interface CachedCookies {
  /** auth_token Cookie の値 */
  auth_token: string
  /** ct0 Cookie の値 */
  ct0: string
  /** 保存日時 (Unix ミリ秒) */
  savedAt: number
}

/** 保存する 1 件のブックマーク情報 */
export interface BookmarkEntry {
  /** ツイート ID */
  tweetId: string
  /** ユーザー ID (Twitter Snowflake ID) */
  userId: string
  /** ツイート本文 */
  fullText: string
  /** 投稿者スクリーンネーム */
  screenName: string
  /** 投稿者表示名 */
  userName: string
  /** 投稿者プロフィール画像 URL */
  profileImageUrl: string | null
  /** 投稿日時 (UTC ISO 8601 文字列) */
  createdAt: string
  /** メディアアイテム一覧（写真・動画・GIF） */
  mediaItems: MediaItem[]
  /** URL エンティティ（t.co → 展開 URL） */
  urlEntities: UrlEntity[]
  /** 引用ツイート情報（引用ツイートがない場合は null） */
  quotedTweet: QuotedTweet | null
  /** カード動画プレーヤー URL（YouTube 等の embed URL） */
  cardPlayerUrl: string | null
  /** リンクカード情報（OGP 相当） */
  cardInfo: CardInfo | null
  /** Grok 翻訳テキスト（翻訳がない場合は null） */
  translatedText: string | null
  /** 翻訳元言語コード (BCP47、例: 'en'。翻訳がない場合は null) */
  sourceLanguage: string | null
  /** 翻訳先言語コード (BCP47、例: 'ja'。翻訳がない場合は null) */
  destinationLanguage: string | null
  /** 翻訳テキスト内の URL エンティティ（t.co を展開 URL に置換するために使用。翻訳がない場合は空配列） */
  translatedUrlEntities: BookmarkEntry['urlEntities']
}
