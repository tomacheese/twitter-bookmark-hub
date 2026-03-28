import Database from 'better-sqlite3'
import { SCHEMA_DDL } from '@twitter-bookmark-hub/shared'
import type { BookmarkEntry } from '../shared/types'

/**
 * データベースを初期化する。
 * WAL モードと外部キー制約を有効化し、必要なテーブル・インデックスを作成する。
 *
 * @param dbPath データベースファイルのパス
 * @returns Database インスタンス
 */
export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  db.pragma('journal_mode=WAL')
  db.pragma('busy_timeout=5000')
  db.pragma('foreign_keys=ON')

  db.exec(SCHEMA_DDL)

  return db
}

/**
 * ユーザー情報を upsert する。
 * 既存レコードがあれば screen_name・user_name・profile_image_url を更新する。
 *
 * @param db Database インスタンス
 * @param userId Twitter ユーザー ID (Snowflake)
 * @param screenName スクリーンネーム
 * @param userName 表示名
 * @param profileImageUrl プロフィール画像 URL
 * @param updatedAt 更新日時 (ISO 8601)
 */
function upsertUser(
  db: Database.Database,
  userId: string,
  screenName: string,
  userName: string,
  profileImageUrl: string | null,
  updatedAt: string
): void {
  db.prepare(
    `
    INSERT INTO users (user_id, screen_name, user_name, profile_image_url, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      screen_name       = excluded.screen_name,
      user_name         = excluded.user_name,
      profile_image_url = excluded.profile_image_url,
      updated_at        = excluded.updated_at
  `
  ).run(userId, screenName, userName, profileImageUrl, updatedAt)
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
}

/**
 * ツイートレコードを upsert する（users への依存を前提とする）。
 * media_items・url_entities は削除してから再挿入する。
 * この関数は呼び出し元のトランザクション内で実行されることを前提とする。
 * 単独で呼び出した場合、media_items の削除と再挿入が原子的に行われない。
 *
 * @param db Database インスタンス
 * @param record ツイートレコード
 * @param quotedTweetId 引用ツイート ID（なければ null）
 */
function upsertTweetRecord(
  db: Database.Database,
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

  db.prepare(
    `
    INSERT INTO tweets (
      tweet_id, user_id, full_text, created_at, quoted_tweet_id,
      card_type, card_url, card_vanity_url, card_title, card_description, card_thumbnail_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tweet_id) DO UPDATE SET
      user_id            = excluded.user_id,
      full_text          = excluded.full_text,
      created_at         = excluded.created_at,
      quoted_tweet_id    = excluded.quoted_tweet_id,
      card_type          = excluded.card_type,
      card_url           = excluded.card_url,
      card_vanity_url    = excluded.card_vanity_url,
      card_title         = excluded.card_title,
      card_description   = excluded.card_description,
      card_thumbnail_url = excluded.card_thumbnail_url
  `
  ).run(
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
    record.cardInfo?.thumbnailUrl ?? null
  )

  // media_items を差し替える
  db.prepare('DELETE FROM media_items WHERE tweet_id = ?').run(record.tweetId)
  const insertMedia = db.prepare(
    'INSERT INTO media_items (tweet_id, position, type, thumb_url, video_url) VALUES (?, ?, ?, ?, ?)'
  )
  for (const [i, item] of record.mediaItems.entries()) {
    insertMedia.run(
      record.tweetId,
      i,
      item.type,
      item.thumbUrl,
      item.videoUrl ?? null
    )
  }

  // url_entities を差し替える
  db.prepare('DELETE FROM url_entities WHERE tweet_id = ?').run(record.tweetId)
  const insertUrl = db.prepare(
    'INSERT INTO url_entities (tweet_id, url, expanded_url, display_url) VALUES (?, ?, ?, ?)'
  )
  for (const ue of record.urlEntities) {
    insertUrl.run(record.tweetId, ue.url, ue.expandedUrl, ue.displayUrl)
  }
}

/**
 * ブックマークエントリをトランザクションで upsert する。
 * ユーザー → 引用ツイート → 本ツイートの順に処理し、FK 制約を満たす。
 *
 * @param db Database インスタンス
 * @param entry ブックマークエントリ
 */
export const upsertTweetEntry = (
  db: Database.Database,
  entry: BookmarkEntry
): void => {
  const now = new Date().toISOString()

  db.transaction(() => {
    // 主ツイートのユーザーを upsert
    upsertUser(
      db,
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
        db,
        qt.userId,
        qt.screenName,
        qt.userName,
        qt.profileImageUrl,
        now
      )
      upsertTweetRecord(
        db,
        {
          tweetId: qt.tweetId,
          userId: qt.userId,
          fullText: qt.fullText,
          createdAt: qt.createdAt,
          mediaItems: qt.mediaItems,
          urlEntities: qt.urlEntities,
          cardPlayerUrl: null,
          cardInfo: null,
        },
        null
      )
      quotedTweetId = qt.tweetId
    }

    // 主ツイートを upsert
    upsertTweetRecord(db, entry, quotedTweetId)
  })()
}

/**
 * ブックマーク関連付けを upsert する。
 * 初回挿入時は first_bookmarked_at を設定し、以降は last_seen_at・position のみ更新する。
 *
 * @param db Database インスタンス
 * @param tweetId ツイート ID
 * @param accountUsername アカウントのユーザー名
 * @param crawledAt クロール日時 (ISO 文字列)
 * @param position Twitter API レスポンス内での順序 (0 = 最新のブックマーク)
 */
export function upsertBookmark(
  db: Database.Database,
  tweetId: string,
  accountUsername: string,
  crawledAt: string,
  position: number
): void {
  db.prepare(
    `
    INSERT INTO bookmarks (tweet_id, account_username, first_bookmarked_at, last_seen_at, position)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tweet_id, account_username) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      position     = excluded.position
  `
  ).run(tweetId, accountUsername, crawledAt, crawledAt, position)
}

/**
 * ブックマークレコードを DB から削除する。
 *
 * @param db Database インスタンス
 * @param tweetId ツイート ID
 * @param accountUsername アカウントのユーザー名
 */
export function deleteBookmark(
  db: Database.Database,
  tweetId: string,
  accountUsername: string
): void {
  db.prepare(
    'DELETE FROM bookmarks WHERE tweet_id = ? AND account_username = ?'
  ).run(tweetId, accountUsername)
}

/**
 * 指定アカウントの全ブックマーク tweet_id を返す。
 * クロール後の差分削除処理で使用する。
 *
 * @param db Database インスタンス
 * @param accountUsername アカウントのユーザー名
 * @returns tweet_id の配列
 */
export function getBookmarkTweetIds(
  db: Database.Database,
  accountUsername: string
): string[] {
  return db
    .prepare('SELECT tweet_id FROM bookmarks WHERE account_username = ?')
    .pluck()
    .all(accountUsername) as string[]
}

/**
 * クロールジョブを新規作成する。
 *
 * @param db Database インスタンス
 * @returns 作成されたジョブの ID
 */
export function createCrawlJob(db: Database.Database): number {
  const result = db
    .prepare(
      "INSERT INTO crawl_jobs (started_at, status) VALUES (?, 'running')"
    )
    .run(new Date().toISOString())
  return Number(result.lastInsertRowid)
}

/**
 * クロールジョブのステータスを更新する。
 *
 * @param db Database インスタンス
 * @param id ジョブ ID
 * @param status ジョブステータス
 * @param opts オプション（終了日時、エラーメッセージ、アカウント数）
 */
export function updateCrawlJob(
  db: Database.Database,
  id: number,
  status: 'running' | 'success' | 'error',
  opts?: {
    finishedAt?: string
    errorMessage?: string
    accountsTotal?: number
    accountsSucceeded?: number
  }
): void {
  db.prepare(
    `
    UPDATE crawl_jobs SET
      status             = ?,
      finished_at        = COALESCE(?, finished_at),
      error_message      = COALESCE(?, error_message),
      accounts_total     = COALESCE(?, accounts_total),
      accounts_succeeded = COALESCE(?, accounts_succeeded)
    WHERE id = ?
  `
  ).run(
    status,
    opts?.finishedAt ?? null,
    opts?.errorMessage ?? null,
    opts?.accountsTotal ?? null,
    opts?.accountsSucceeded ?? null,
    id
  )
}

/**
 * 最新のクロールジョブを取得する。
 *
 * @param db Database インスタンス
 * @returns ジョブレコードまたは null
 */
export function getLatestCrawlJob(
  db: Database.Database
): Record<string, unknown> | null {
  const row = db
    .prepare('SELECT * FROM crawl_jobs ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined
  return row ?? null
}

/**
 * タグ名を upsert し、ツイートとタグの関連を保存する。
 * 既存の関連の削除と新規挿入をトランザクション内で原子的に実行する。
 *
 * @param db Database インスタンス
 * @param tweetId ツイート ID
 * @param tagNames タグ名（名詞）の配列
 */
export function upsertTweetTags(
  db: Database.Database,
  tweetId: string,
  tagNames: string[]
): void {
  // タグ名を upsert して ID を取得する
  const upsertTag = db.prepare(
    'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id'
  )

  const deleteTweetTags = db.prepare(
    'DELETE FROM tweet_tags WHERE tweet_id = ?'
  )

  const insertTweetTag = db.prepare(
    'INSERT OR IGNORE INTO tweet_tags (tweet_id, tag_id) VALUES (?, ?)'
  )

  // 削除と挿入をトランザクション内で原子的に実行する
  // tagNames が空配列の場合も既存タグを削除して関連をリセットする
  db.transaction(() => {
    deleteTweetTags.run(tweetId)
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
 * @param db Database インスタンス
 * @param tweetId ツイート ID
 * @param categories カテゴリ ID と信頼度スコアの配列
 */
export function upsertTweetCategories(
  db: Database.Database,
  tweetId: string,
  categories: { id: number; confidence: number }[]
): void {
  const deleteTweetCategories = db.prepare(
    'DELETE FROM tweet_categories WHERE tweet_id = ?'
  )

  const insertTweetCategory = db.prepare(
    'INSERT OR IGNORE INTO tweet_categories (tweet_id, category_id, confidence) VALUES (?, ?, ?)'
  )

  // 削除と挿入をトランザクション内で原子的に実行する
  db.transaction(() => {
    deleteTweetCategories.run(tweetId)
    for (const cat of categories) {
      insertTweetCategory.run(tweetId, cat.id, cat.confidence)
    }
  })()
}
