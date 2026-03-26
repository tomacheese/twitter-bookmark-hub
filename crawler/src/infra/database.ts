import Database from 'better-sqlite3'
import type { BookmarkEntry } from '../shared/types.js'

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

  // NOTE: 以下の DDL は viewer/backend/src/infra/database.ts と同一でなければならない。
  // スキーマを変更する場合は両ファイルを同時に更新すること。
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id           TEXT PRIMARY KEY,
      screen_name       TEXT NOT NULL,
      user_name         TEXT NOT NULL,
      profile_image_url TEXT,
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tweets (
      tweet_id           TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL,
      full_text          TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      quoted_tweet_id    TEXT,
      card_type          TEXT CHECK(card_type IN ('player', 'summary', 'summary_large_image')),
      card_url           TEXT,
      card_vanity_url    TEXT,
      card_title         TEXT,
      card_description   TEXT,
      card_thumbnail_url TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (quoted_tweet_id) REFERENCES tweets(tweet_id)
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id  TEXT NOT NULL,
      position  INTEGER NOT NULL DEFAULT 0,
      type      TEXT NOT NULL CHECK(type IN ('photo', 'video', 'animated_gif')),
      thumb_url TEXT NOT NULL,
      video_url TEXT,
      FOREIGN KEY (tweet_id) REFERENCES tweets(tweet_id)
    );

    CREATE TABLE IF NOT EXISTS url_entities (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id     TEXT NOT NULL,
      url          TEXT NOT NULL,
      expanded_url TEXT NOT NULL,
      display_url  TEXT NOT NULL,
      FOREIGN KEY (tweet_id) REFERENCES tweets(tweet_id)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      tweet_id             TEXT NOT NULL,
      account_username     TEXT NOT NULL,
      first_bookmarked_at  TEXT NOT NULL,
      last_seen_at         TEXT NOT NULL,
      position             INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tweet_id, account_username),
      FOREIGN KEY (tweet_id) REFERENCES tweets(tweet_id)
    );

    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at         TEXT NOT NULL,
      finished_at        TEXT,
      status             TEXT NOT NULL CHECK(status IN ('running', 'success', 'error')),
      error_message      TEXT,
      accounts_total     INTEGER,
      accounts_succeeded INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tweets_user_id         ON tweets(user_id);
    CREATE INDEX IF NOT EXISTS idx_tweets_created_at      ON tweets(created_at);
    CREATE INDEX IF NOT EXISTS idx_media_items_tweet_id   ON media_items(tweet_id);
    CREATE INDEX IF NOT EXISTS idx_url_entities_tweet_id  ON url_entities(tweet_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_account      ON bookmarks(account_username);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_last_seen    ON bookmarks(last_seen_at);
  `)

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
