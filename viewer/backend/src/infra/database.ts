import Database from 'better-sqlite3'
import { SCHEMA_DDL } from '@twitter-bookmark-hub/shared'
import type {
  CardInfo,
  CrawlJobStatus,
  MediaItem,
  QuotedTweet,
  UrlEntity,
} from '@twitter-bookmark-hub/shared'
import type { BookmarkItem, AccountInfo } from '../shared/types'

/** ブックマーク取得時のパラメータ */
interface GetBookmarksParams {
  /** ページ番号 */
  page: number
  /** 1 ページあたりの件数 */
  limit: number
  /** 検索クエリ（ツイート本文で部分一致） */
  q?: string
  /** アカウントでフィルタ */
  account?: string
  /** ソートキー (bookmarked_at: ブックマーク初回発見日 / created_at: ツイート投稿日) */
  sortBy?: 'bookmarked_at' | 'created_at'
  /** ソート順 (desc: 新しい順 / asc: 古い順) */
  sort?: 'asc' | 'desc'
  /** カテゴリ ID でフィルタ */
  categoryId?: number
  /** タグ名でフィルタ（完全一致） */
  tag?: string
}

/** ブックマーク取得結果 */
interface GetBookmarksResult {
  /** ブックマークアイテム一覧 */
  items: BookmarkItem[]
  /** 総件数 */
  total: number
}

/**
 * SQLite データベースを開く。
 * crawler が先に起動していない場合に備えてテーブルを作成し、
 * WAL モードと外部キー制約を有効にする。
 *
 * @param dbPath - データベースファイルのパス
 * @returns Database インスタンス
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode=WAL')
  db.pragma('busy_timeout=5000')
  db.pragma('foreign_keys=ON')

  // crawler が先に起動していない場合に備えてテーブルを作成
  db.exec(SCHEMA_DDL)

  return db
}

/**
 * DB から取得した JSON 文字列を MediaItem[] にパースする。
 * json_group_array が null や空配列を返す場合にも対応する。
 *
 * @param raw - DB から取得した JSON 文字列または null
 * @returns MediaItem 配列
 */
function parseMediaItems(raw: string | null): MediaItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is MediaItem =>
        item !== null && typeof item === 'object' && 'thumbUrl' in item
    )
  } catch {
    return []
  }
}

/**
 * DB から取得した JSON 文字列を UrlEntity[] にパースする。
 *
 * @param raw - DB から取得した JSON 文字列または null
 * @returns UrlEntity 配列
 */
function parseUrlEntities(raw: string | null): UrlEntity[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is UrlEntity =>
        item !== null && typeof item === 'object' && 'url' in item
    )
  } catch {
    return []
  }
}

/**
 * DB から取得した JSON 文字列をタグ名の配列にパースする。
 *
 * @param raw - DB から取得した JSON 文字列または null
 * @returns タグ名の配列
 */
function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

/**
 * DB から取得した JSON 文字列をカテゴリ情報の配列にパースする。
 *
 * @param raw - DB から取得した JSON 文字列または null
 * @returns カテゴリ情報の配列
 */
function parseCategories(
  raw: string | null
): { id: number; name: string; color: string }[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is { id: number; name: string; color: string } =>
        item !== null &&
        typeof item === 'object' &&
        'id' in item &&
        'name' in item &&
        'color' in item
    )
  } catch {
    return []
  }
}

/**
 * 指定テーブルが SQLite に存在するかどうかを確認する。
 * analyzer がオプショナルなため、タグ・カテゴリテーブルが存在しない場合がある。
 *
 * @param db - Database インスタンス
 * @param tableName - テーブル名
 * @returns テーブルが存在すれば true
 */
function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName)
  return row !== undefined
}

/**
 * tweet_categories テーブルが存在するかどうかを確認する。
 * analyzer がオプショナルなため、テーブルが存在しない場合がある。
 *
 * @param db - Database インスタンス
 * @returns テーブルが存在すれば true
 */
export function hasCategoriesTable(db: Database.Database): boolean {
  return tableExists(db, 'tweet_categories')
}

/**
 * ブックマーク一覧を取得する
 * @param db - Database インスタンス
 * @param params - 取得パラメータ
 * @returns ブックマークアイテム一覧と総件数
 */
export function getBookmarks(
  db: Database.Database,
  params: GetBookmarksParams
): GetBookmarksResult {
  const {
    page,
    limit,
    q,
    account,
    sort = 'desc',
    sortBy = 'bookmarked_at',
  } = params

  // tweet_tags / tweet_categories テーブルが存在しない場合はサブクエリを省略する
  const tagsTableExists = tableExists(db, 'tweet_tags')
  const categoriesTableExists = hasCategoriesTable(db)
  const effectiveCategoryId = categoriesTableExists
    ? params.categoryId
    : undefined

  // ソートキーと方向を決定する（SQL インジェクション防止のためホワイトリスト方式）
  //
  // ブックマーク発見日ソート: MAX(b.last_seen_at) を主キーとし、
  //   同一クロール実行内（last_seen_at が同一）では MIN(b.position) を副キーにする。
  //   position は Twitter API のレスポンス順（小さいほど新しいブックマーク）。
  //
  // 投稿日ソート: tweet_id は Snowflake ID で時系列単調増加のため数値比較を使用する。
  const orderDir = sort === 'asc' ? 'ASC' : 'DESC'
  let primaryKey: string
  let secondaryClause: string
  if (sortBy === 'created_at') {
    primaryKey = 'CAST(t.tweet_id AS INTEGER)'
    secondaryClause = ''
  } else {
    primaryKey = 'MAX(b.last_seen_at)'
    const posDir = sort === 'desc' ? 'ASC' : 'DESC'
    secondaryClause = `, MIN(b.position) ${posDir}`
  }

  // WHERE 句の構築
  const conditions: string[] = []
  const bindValues: unknown[] = []

  if (q) {
    conditions.push('t.full_text LIKE ?')
    bindValues.push(`%${q}%`)
  }
  if (account) {
    // EXISTS サブクエリでフィルタすることで、メインの bookmarks JOIN の集計
    // （GROUP_CONCAT・MIN/MAX）が全アカウントを対象にしたままになる
    conditions.push(
      'EXISTS (SELECT 1 FROM bookmarks b2 WHERE b2.tweet_id = t.tweet_id AND b2.account_username = ?)'
    )
    bindValues.push(account)
  }
  if (effectiveCategoryId !== undefined) {
    conditions.push(
      'EXISTS (SELECT 1 FROM tweet_categories tc WHERE tc.tweet_id = t.tweet_id AND tc.category_id = ?)'
    )
    bindValues.push(effectiveCategoryId)
  }
  if (params.tag && tagsTableExists) {
    conditions.push(
      'EXISTS (SELECT 1 FROM tweet_tags tt JOIN tags tg ON tt.tag_id = tg.id WHERE tt.tweet_id = t.tweet_id AND tg.name = ?)'
    )
    bindValues.push(params.tag)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 総件数を取得（ツイート単位でカウント）
  const countSql = `
    SELECT COUNT(DISTINCT t.tweet_id) as cnt
    FROM tweets t
    INNER JOIN bookmarks b ON t.tweet_id = b.tweet_id
    ${whereClause}
  `
  const countRow = db.prepare(countSql).get(...bindValues) as { cnt: number }
  const total = countRow.cnt

  // ブックマーク一覧を取得
  // メディアアイテム・URL エンティティ・引用ツイート情報はサブクエリで集約する
  const offset = (page - 1) * limit
  const dataSql = `
    SELECT
      t.tweet_id,
      t.full_text,
      t.created_at,
      t.quoted_tweet_id,
      t.card_type,
      t.card_url,
      t.card_vanity_url,
      t.card_title,
      t.card_description,
      t.card_thumbnail_url,
      u.screen_name,
      u.user_name,
      u.profile_image_url,
      MIN(b.first_bookmarked_at) AS bookmarked_at,
      GROUP_CONCAT(b.account_username) AS bookmarked_by,
      (
        SELECT json_group_array(json_object(
          'type', mi.type,
          'thumbUrl', mi.thumb_url,
          'videoUrl', mi.video_url
        ))
        FROM media_items mi
        WHERE mi.tweet_id = t.tweet_id
        ORDER BY mi.position
      ) AS media_items,
      (
        SELECT json_group_array(json_object(
          'url', ue.url,
          'expandedUrl', ue.expanded_url,
          'displayUrl', ue.display_url
        ))
        FROM url_entities ue
        WHERE ue.tweet_id = t.tweet_id
      ) AS url_entities,
      qt.tweet_id        AS qt_tweet_id,
      qt.full_text       AS qt_full_text,
      qt.user_id         AS qt_user_id,
      qt.created_at      AS qt_created_at,
      qu.screen_name     AS qt_screen_name,
      qu.user_name       AS qt_user_name,
      qu.profile_image_url AS qt_profile_image_url,
      (
        SELECT json_group_array(json_object(
          'type', mi.type,
          'thumbUrl', mi.thumb_url,
          'videoUrl', mi.video_url
        ))
        FROM media_items mi
        WHERE mi.tweet_id = t.quoted_tweet_id
        ORDER BY mi.position
      ) AS qt_media_items,
      (
        SELECT json_group_array(json_object(
          'url', ue.url,
          'expandedUrl', ue.expanded_url,
          'displayUrl', ue.display_url
        ))
        FROM url_entities ue
        WHERE ue.tweet_id = t.quoted_tweet_id
      ) AS qt_url_entities${
        tagsTableExists
          ? `,
      (
        SELECT json_group_array(tg.name)
        FROM tweet_tags tt
        JOIN tags tg ON tt.tag_id = tg.id
        WHERE tt.tweet_id = t.tweet_id
      ) AS tweet_tags_json`
          : ''
      }${
        categoriesTableExists
          ? `,
      (
        SELECT json_group_array(json_object('id', c.id, 'name', c.name, 'color', c.color))
        FROM tweet_categories tc
        JOIN categories c ON tc.category_id = c.id
        WHERE tc.tweet_id = t.tweet_id
      ) AS tweet_categories_json`
          : ''
      }
    FROM tweets t
    INNER JOIN users u ON t.user_id = u.user_id
    INNER JOIN bookmarks b ON t.tweet_id = b.tweet_id
    LEFT JOIN tweets qt ON t.quoted_tweet_id = qt.tweet_id
    LEFT JOIN users qu ON qt.user_id = qu.user_id
    ${whereClause}
    GROUP BY t.tweet_id
    ORDER BY ${primaryKey} ${orderDir}${secondaryClause}
    LIMIT ? OFFSET ?
  `

  const rows = db.prepare(dataSql).all(...bindValues, limit, offset) as {
    tweet_id: string
    full_text: string
    created_at: string
    quoted_tweet_id: string | null
    card_type: string | null
    card_url: string | null
    card_vanity_url: string | null
    card_title: string | null
    card_description: string | null
    card_thumbnail_url: string | null
    screen_name: string
    user_name: string
    profile_image_url: string | null
    bookmarked_at: string
    bookmarked_by: string
    media_items: string | null
    url_entities: string | null
    qt_tweet_id: string | null
    qt_full_text: string | null
    qt_user_id: string | null
    qt_created_at: string | null
    qt_screen_name: string | null
    qt_user_name: string | null
    qt_profile_image_url: string | null
    qt_media_items: string | null
    qt_url_entities: string | null
    tweet_tags_json?: string | null
    tweet_categories_json?: string | null
  }[]

  const items: BookmarkItem[] = rows.map((row) => {
    // 引用ツイートの組み立て
    let quotedTweet: QuotedTweet | null = null
    if (row.qt_tweet_id && row.qt_full_text !== null) {
      quotedTweet = {
        tweetId: row.qt_tweet_id,
        fullText: row.qt_full_text,
        userId: row.qt_user_id ?? '',
        createdAt: row.qt_created_at ?? '',
        screenName: row.qt_screen_name ?? '',
        userName: row.qt_user_name ?? '',
        profileImageUrl: row.qt_profile_image_url,
        mediaItems: parseMediaItems(row.qt_media_items),
        urlEntities: parseUrlEntities(row.qt_url_entities),
      }
    }

    // カード情報の組み立て
    let cardPlayerUrl: string | null = null
    let cardInfo: CardInfo | null = null
    if (row.card_type === 'player') {
      cardPlayerUrl = row.card_url
    } else if (
      (row.card_type === 'summary' ||
        row.card_type === 'summary_large_image') &&
      row.card_url
    ) {
      cardInfo = {
        cardType: row.card_type,
        cardUrl: row.card_url,
        vanityUrl: row.card_vanity_url ?? '',
        title: row.card_title ?? '',
        description: row.card_description ?? '',
        thumbnailUrl: row.card_thumbnail_url,
      }
    }

    return {
      tweetId: row.tweet_id,
      fullText: row.full_text,
      screenName: row.screen_name,
      userName: row.user_name,
      profileImageUrl: row.profile_image_url,
      createdAt: row.created_at,
      bookmarkedAt: row.bookmarked_at,
      tweetUrl: `https://twitter.com/${row.screen_name}/status/${row.tweet_id}`,
      mediaItems: parseMediaItems(row.media_items),
      bookmarkedBy: row.bookmarked_by ? row.bookmarked_by.split(',') : [],
      urlEntities: parseUrlEntities(row.url_entities),
      quotedTweet,
      cardPlayerUrl,
      cardInfo,
      tags: parseTags(row.tweet_tags_json ?? null),
      categories: parseCategories(row.tweet_categories_json ?? null),
    }
  })

  return { items, total }
}

/**
 * アカウント一覧とブックマーク件数を取得する
 * @param db - Database インスタンス
 * @returns アカウント情報の配列
 */
export function getAccounts(db: Database.Database): AccountInfo[] {
  const rows = db
    .prepare(
      `
    SELECT account_username AS username, COUNT(*) AS bookmark_count
    FROM bookmarks
    GROUP BY account_username
    ORDER BY account_username
  `
    )
    .all() as { username: string; bookmark_count: number }[]

  return rows.map((row) => ({
    username: row.username,
    bookmarkCount: row.bookmark_count,
  }))
}

/**
 * 最新のクロールジョブを取得する
 * @param db - Database インスタンス
 * @returns 最新のクロールジョブ情報、存在しない場合は null
 */
export function getLatestCrawlJob(
  db: Database.Database
): CrawlJobStatus | null {
  const row = db
    .prepare(
      `
    SELECT id, started_at, finished_at, status, error_message,
           accounts_total, accounts_succeeded
    FROM crawl_jobs
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get() as
    | {
        id: number
        started_at: string
        finished_at: string | null
        status: 'running' | 'success' | 'error'
        error_message: string | null
        accounts_total: number | null
        accounts_succeeded: number | null
      }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    errorMessage: row.error_message,
    accountsTotal: row.accounts_total,
    accountsSucceeded: row.accounts_succeeded,
  }
}
