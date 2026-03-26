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

/** リンクカード情報（Twitter の summary / summary_large_image カード） */
export interface CardInfo {
  /** カード種別 (summary / summary_large_image) */
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

/** 引用ツイート情報 */
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
}
