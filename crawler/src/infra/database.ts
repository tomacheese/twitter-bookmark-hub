import Database from 'better-sqlite3'
import {
  SCHEMA_DDL,
  applyColumnMigrations,
  type CrawlAccountResult,
} from '@twitter-bookmark-hub/shared'
import type { BookmarkEntry } from '../shared/types'

/**
 * データベースを初期化する。
 * WAL モードと外部キー制約を有効化し、必要なテーブル・インデックスを作成する。
 *
 * @param databasePath データベースファイルのパス
 * @returns Database インスタンス
 */
export function initDatabase(databasePath: string): Database.Database {
  const database = new Database(databasePath)

  database.pragma('journal_mode=WAL')
  database.pragma('busy_timeout=5000')
  database.pragma('foreign_keys=ON')

  database.exec(SCHEMA_DDL)
  applyColumnMigrations(database)

  return database
}

/**
 * ユーザー情報を upsert する。
 * 既存レコードがあれば screen_name・user_name・profile_image_url を更新する。
 *
 * @param database Database インスタンス
 * @param userId Twitter ユーザー ID (Snowflake)
 * @param screenName スクリーンネーム
 * @param username 表示名
 * @param profileImageUrl プロフィール画像 URL
 * @param updatedAt 更新日時 (ISO 8601)
 */
function upsertUser(
  database: Database.Database,
  userId: string,
  screenName: string,
  username: string,
  profileImageUrl: string | null,
  updatedAt: string
): void {
  database
    .prepare(
      `
    INSERT INTO users (user_id, screen_name, user_name, profile_image_url, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      screen_name       = excluded.screen_name,
      user_name         = excluded.user_name,
      profile_image_url = excluded.profile_image_url,
      updated_at        = excluded.updated_at
  `
    )
    .run(userId, screenName, username, profileImageUrl, updatedAt)
}

/** upsertTweetRecord に渡すツイートの最小限の情報 */
interface TweetRecord {
  tweetId: string
  userId: string
  fullText: string
  createdAt: string
  mediaItems: BookmarkEntry['mediaItems']
  urlEntities: BookmarkEntry['urlEntities']
  cardPlayerUrl: string | null
  cardInfo: BookmarkEntry['cardInfo']
  /** Grok 翻訳テキスト（翻訳がない場合は null） */
  translatedText: string | null
  /** 翻訳元言語コード (BCP47。翻訳がない場合は null) */
  sourceLanguage: string | null
  /** 翻訳先言語コード (BCP47。翻訳がない場合は null) */
  destinationLanguage: string | null
  /** 翻訳テキスト内の URL エンティティ（翻訳がない場合は空配列） */
  translatedUrlEntities: BookmarkEntry['urlEntities']
}

/**
 * ツイートレコードを upsert する（users への依存を前提とする）。
 * media_items と kind='original' の url_entities は削除してから再挿入する。
 * kind='translated' の url_entities は translatedText が非 null の場合のみ削除・再挿入し、
 * null の場合は既存データを保持する（再クロール時に Grok が翻訳を返さなかった場合の消失を防ぐため）。
 * この関数は呼び出し元のトランザクション内で実行されることを前提とする。
 * 単独で呼び出した場合、削除と再挿入が原子的に行われない。
 *
 * @param database Database インスタンス
 * @param record ツイートレコード
 * @param quotedTweetId 引用ツイート ID（なければ null）
 */
function upsertTweetRecord(
  database: Database.Database,
  record: TweetRecord,
  quotedTweetId: string | null
): void {
  // player カードの場合は card_type = 'player'、card_url = playerUrl
  // summary / summary_large_image カードの場合は card_type = cardInfo.cardType、card_url = cardInfo.cardUrl
  const cardType: string | null = record.cardPlayerUrl
    ? 'player'
    : (record.cardInfo?.cardType ?? null)
  const cardUrl: string | null =
    record.cardPlayerUrl ?? record.cardInfo?.cardUrl ?? null

  database
    .prepare(
      `
    INSERT INTO tweets (
      tweet_id, user_id, full_text, created_at, quoted_tweet_id,
      card_type, card_url, card_vanity_url, card_title, card_description, card_thumbnail_url,
      translated_text, source_language, destination_language
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tweet_id) DO UPDATE SET
      user_id              = excluded.user_id,
      full_text            = excluded.full_text,
      created_at           = excluded.created_at,
      quoted_tweet_id      = excluded.quoted_tweet_id,
      card_type            = excluded.card_type,
      card_url             = excluded.card_url,
      card_vanity_url      = excluded.card_vanity_url,
      card_title           = excluded.card_title,
      card_description     = excluded.card_description,
      card_thumbnail_url   = excluded.card_thumbnail_url,
      translated_text      = COALESCE(excluded.translated_text, tweets.translated_text),
      source_language      = COALESCE(excluded.source_language, tweets.source_language),
      destination_language = COALESCE(excluded.destination_language, tweets.destination_language)
  `
    )
    .run(
      record.tweetId,
      record.userId,
      record.fullText,
      record.createdAt,
      quotedTweetId,
      cardType,
      cardUrl,
      record.cardInfo?.vanityUrl ?? null,
      record.cardInfo?.title ?? null,
      record.cardInfo?.description ?? null,
      record.cardInfo?.thumbnailUrl ?? null,
      record.translatedText,
      record.sourceLanguage,
      record.destinationLanguage
    )

  // media_items を差し替える
  database
    .prepare('DELETE FROM media_items WHERE tweet_id = ?')
    .run(record.tweetId)
  const insertMedia = database.prepare(
    'INSERT INTO media_items (tweet_id, position, type, thumb_url, video_url) VALUES (?, ?, ?, ?, ?)'
  )
  for (const [index, item] of record.mediaItems.entries()) {
    insertMedia.run(
      record.tweetId,
      index,
      item.type,
      item.thumbUrl,
      item.videoUrl ?? null
    )
  }

  // オリジナル url_entities を差し替える（翻訳用エンティティは削除しない）
  database
    .prepare('DELETE FROM url_entities WHERE tweet_id = ? AND kind = ?')
    .run(record.tweetId, 'original')
  const insertUrl = database.prepare(
    'INSERT INTO url_entities (tweet_id, url, expanded_url, display_url, kind) VALUES (?, ?, ?, ?, ?)'
  )
  for (const ue of record.urlEntities) {
    insertUrl.run(
      record.tweetId,
      ue.url,
      ue.expandedUrl,
      ue.displayUrl,
      'original'
    )
  }

  // 翻訳テキストがある場合のみ翻訳用 url_entities を差し替える（null 時は既存データを保持）
  if (record.translatedText !== null) {
    database
      .prepare('DELETE FROM url_entities WHERE tweet_id = ? AND kind = ?')
      .run(record.tweetId, 'translated')
    const insertTranslatedUrl = database.prepare(
      'INSERT INTO url_entities (tweet_id, url, expanded_url, display_url, kind) VALUES (?, ?, ?, ?, ?)'
    )
    for (const entity of record.translatedUrlEntities) {
      insertTranslatedUrl.run(
        record.tweetId,
        entity.url,
        entity.expandedUrl,
        entity.displayUrl,
        'translated'
      )
    }
  }
}

/**
 * ブックマークエントリをトランザクションで upsert する。
 * ユーザー → 引用ツイート → 本ツイートの順に処理し、FK 制約を満たす。
 *
 * @param database Database インスタンス
 * @param entry ブックマークエントリ
 */
export const upsertTweetEntry = (
  database: Database.Database,
  entry: BookmarkEntry
): void => {
  const now = new Date().toISOString()

  database.transaction(() => {
    // 主ツイートのユーザーを upsert
    upsertUser(
      database,
      entry.userId,
      entry.screenName,
      entry.userName,
      entry.profileImageUrl,
      now
    )

    // 引用ツイートを先に upsert（tweets の FK 制約を満たすため）
    let quotedTweetId: string | null = null
    if (entry.quotedTweet) {
      const qt = entry.quotedTweet
      upsertUser(
        database,
        qt.userId,
        qt.screenName,
        qt.userName,
        qt.profileImageUrl,
        now
      )
      upsertTweetRecord(
        database,
        {
          tweetId: qt.tweetId,
          userId: qt.userId,
          fullText: qt.fullText,
          createdAt: qt.createdAt,
          mediaItems: qt.mediaItems,
          urlEntities: qt.urlEntities,
          cardPlayerUrl: null,
          cardInfo: null,
          translatedText: qt.translatedText,
          sourceLanguage: qt.sourceLanguage,
          destinationLanguage: qt.destinationLanguage,
          translatedUrlEntities: qt.translatedUrlEntities,
        },
        null
      )
      quotedTweetId = qt.tweetId
    }

    // 主ツイートを upsert
    upsertTweetRecord(database, entry, quotedTweetId)
  })()
}

/**
 * ブックマーク関連付けを upsert する。
 * 初回挿入時は first_bookmarked_at を設定し、以降は last_seen_at・position のみ更新する。
 *
 * @param database Database インスタンス
 * @param tweetId ツイート ID
 * @param accountUsername アカウントのユーザー名
 * @param crawledAt クロール日時 (ISO 文字列)
 * @param position Twitter API レスポンス内での順序 (0 = 最新のブックマーク)
 */
export function upsertBookmark(
  database: Database.Database,
  tweetId: string,
  accountUsername: string,
  crawledAt: string,
  position: number
): void {
  database
    .prepare(
      `
    INSERT INTO bookmarks (tweet_id, account_username, first_bookmarked_at, last_seen_at, position)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tweet_id, account_username) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      position     = excluded.position
  `
    )
    .run(tweetId, accountUsername, crawledAt, crawledAt, position)
}

/**
 * ブックマークレコードを DB から削除する。
 *
 * @param database Database インスタンス
 * @param tweetId ツイート ID
 * @param accountUsername アカウントのユーザー名
 */
export function deleteBookmark(
  database: Database.Database,
  tweetId: string,
  accountUsername: string
): void {
  database
    .prepare(
      'DELETE FROM bookmarks WHERE tweet_id = ? AND account_username = ?'
    )
    .run(tweetId, accountUsername)
}

/**
 * 指定アカウントの全ブックマーク tweet_id を返す。
 * クロール後の差分削除処理で使用する。
 *
 * @param database Database インスタンス
 * @param accountUsername アカウントのユーザー名
 * @returns tweet_id の配列
 */
export function getBookmarkTweetIds(
  database: Database.Database,
  accountUsername: string
): string[] {
  return database
    .prepare('SELECT tweet_id FROM bookmarks WHERE account_username = ?')
    .pluck()
    .all(accountUsername) as string[]
}

/**
 * クロールジョブを新規作成する。
 *
 * @param database Database インスタンス
 * @returns 作成されたジョブの ID
 */
export function createCrawlJob(database: Database.Database): number {
  const result = database
    .prepare(
      "INSERT INTO crawl_jobs (started_at, status) VALUES (?, 'running')"
    )
    .run(new Date().toISOString())
  return Number(result.lastInsertRowid)
}

/**
 * クロールジョブのステータスを更新する。
 *
 * @param database Database インスタンス
 * @param id ジョブ ID
 * @param status ジョブステータス
 * @param options オプション（終了日時、エラーメッセージ、アカウント数）
 */
export function updateCrawlJob(
  database: Database.Database,
  id: number,
  status: 'running' | 'success' | 'error',
  options?: {
    finishedAt?: string
    errorMessage?: string
    accountsTotal?: number
    accountsSucceeded?: number
  }
): void {
  database
    .prepare(
      `
    UPDATE crawl_jobs SET
      status             = ?,
      finished_at        = COALESCE(?, finished_at),
      error_message      = COALESCE(?, error_message),
      accounts_total     = COALESCE(?, accounts_total),
      accounts_succeeded = COALESCE(?, accounts_succeeded)
    WHERE id = ?
  `
    )
    .run(
      status,
      options?.finishedAt ?? null,
      options?.errorMessage ?? null,
      options?.accountsTotal ?? null,
      options?.accountsSucceeded ?? null,
      id
    )
}

/**
 * アカウント別クロール結果を保存する。
 *
 * @param database Database インスタンス
 * @param crawlJobId クロールジョブ ID
 * @param username アカウントのユーザー名
 * @param status 結果ステータス
 * @param errorType エラー種別（成功時は null）
 * @param errorMessage エラーメッセージ（成功時は null）
 * @param bookmarksCrawled クロールしたブックマーク数
 */
export function saveCrawlAccountResult(
  database: Database.Database,
  crawlJobId: number,
  username: string,
  status: 'success' | 'error',
  errorType: 'auth' | 'rate_limit' | 'api' | 'network' | 'unknown' | null,
  errorMessage: string | null,
  bookmarksCrawled: number
): void {
  database
    .prepare(
      `INSERT INTO crawl_account_results
      (crawl_job_id, username, status, error_type, error_message, bookmarks_crawled)
     VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      crawlJobId,
      username,
      status,
      errorType,
      errorMessage,
      bookmarksCrawled
    )
}

/**
 * 指定クロールジョブのアカウント別結果一覧を返す。
 *
 * @param database Database インスタンス
 * @param crawlJobId クロールジョブ ID
 * @returns アカウント別クロール結果の配列
 */
export function getCrawlAccountResults(
  database: Database.Database,
  crawlJobId: number
): CrawlAccountResult[] {
  const rows = database
    .prepare(
      `SELECT username, status, error_type, error_message, bookmarks_crawled
       FROM crawl_account_results
       WHERE crawl_job_id = ?
       ORDER BY id ASC`
    )
    .all(crawlJobId) as {
    username: string
    status: 'success' | 'error'
    error_type: 'auth' | 'rate_limit' | 'api' | 'network' | 'unknown' | null
    error_message: string | null
    bookmarks_crawled: number
  }[]

  return rows.map((row) => ({
    username: row.username,
    status: row.status,
    errorType: row.error_type,
    errorMessage: row.error_message,
    bookmarksCrawled: row.bookmarks_crawled,
  }))
}

/**
 * 最新のクロールジョブをアカウント別結果と合わせて取得する。
 *
 * @param database Database インスタンス
 * @returns ジョブレコードまたは null
 */
export function getLatestCrawlJob(
  database: Database.Database
): (Record<string, unknown> & { accountResults: CrawlAccountResult[] }) | null {
  const row = database
    .prepare('SELECT * FROM crawl_jobs ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined
  if (!row) return null

  const accountResults = getCrawlAccountResults(database, row.id as number)
  return { ...row, accountResults }
}

/**
 * タグ名を upsert し、ツイートとタグの関連を保存する。
 * 既存の関連の削除と新規挿入をトランザクション内で原子的に実行する。
 *
 * @param database Database インスタンス
 * @param tweetId ツイート ID
 * @param tagNames タグ名（名詞）の配列
 */
export function upsertTweetTags(
  database: Database.Database,
  tweetId: string,
  tagNames: string[]
): void {
  // タグ名を upsert して ID を取得する
  const upsertTag = database.prepare(
    'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id'
  )

  const tweetTagsDeleteStatement = database.prepare(
    'DELETE FROM tweet_tags WHERE tweet_id = ?'
  )

  const insertTweetTag = database.prepare(
    'INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id) VALUES (?, ?)'
  )

  // 削除と挿入をトランザクション内で原子的に実行する
  // tagNames が空配列の場合も既存タグを削除して関連をリセットする
  database.transaction(() => {
    tweetTagsDeleteStatement.run(tweetId)
    for (const name of tagNames) {
      const row = upsertTag.get(name) as { id: number } | undefined
      if (row) {
        insertTweetTag.run(tweetId, row.id)
      }
    }
  })()
}

/**
 * ツイートとカテゴリの関連を保存する。
 * 既存の関連の削除と新規挿入をトランザクション内で原子的に実行する。
 *
 * @param database Database インスタンス
 * @param tweetId ツイート ID
 * @param categories カテゴリ ID と信頼度スコアの配列
 */
export function upsertTweetCategories(
  database: Database.Database,
  tweetId: string,
  categories: { id: number; confidence: number }[]
): void {
  const tweetCategoriesDeleteStatement = database.prepare(
    'DELETE FROM tweet_categories WHERE tweet_id = ?'
  )

  const insertTweetCategory = database.prepare(
    'INSERT OR IGNORE INTO tweet_categories (tweet_id, category_id, confidence) VALUES (?, ?, ?)'
  )

  // 削除と挿入をトランザクション内で原子的に実行する
  database.transaction(() => {
    tweetCategoriesDeleteStatement.run(tweetId)
    for (const cat of categories) {
      insertTweetCategory.run(tweetId, cat.id, cat.confidence)
    }
  })()
}
