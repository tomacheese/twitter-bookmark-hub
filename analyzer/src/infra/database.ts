import Database from 'better-sqlite3'
import { SCHEMA_DDL } from '@twitter-bookmark-hub/shared'
import type { CategoryItem, TagItem } from '@twitter-bookmark-hub/shared'

/**
 * データベースを開く。
 * SCHEMA_DDL で tags / tweet_tags / categories / tweet_categories テーブルを作成する。
 *
 * @param dbPath - データベースファイルのパス
 * @returns Database インスタンス
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode=WAL')
  db.pragma('busy_timeout=5000')
  db.pragma('foreign_keys=ON')
  db.exec(SCHEMA_DDL)
  return db
}

/**
 * カテゴリ一覧を取得する。
 * 各カテゴリのブックマーク件数を含む。
 *
 * @param db - Database インスタンス
 * @returns カテゴリアイテムの配列
 */
export function getCategories(db: Database.Database): CategoryItem[] {
  const rows = db
    .prepare(
      `
      SELECT
        c.id,
        c.name,
        c.color,
        c.keywords,
        c.created_at,
        COUNT(DISTINCT tc.tweet_id) AS bookmark_count
      FROM categories c
      LEFT JOIN tweet_categories tc ON c.id = tc.category_id
      GROUP BY c.id
      ORDER BY c.id
      `
    )
    .all() as {
    id: number
    name: string
    color: string
    keywords: string
    created_at: string
    bookmark_count: number
  }[]

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    keywords: JSON.parse(row.keywords) as string[],
    createdAt: row.created_at,
    bookmarkCount: row.bookmark_count,
  }))
}

/**
 * カテゴリを新規作成する。
 *
 * @param db - Database インスタンス
 * @param name - カテゴリ名
 * @param color - カラーコード
 * @param keywords - マッチングキーワード一覧
 * @returns 作成されたカテゴリの ID
 */
export function createCategory(
  db: Database.Database,
  name: string,
  color: string,
  keywords: string[]
): number {
  const result = db
    .prepare('INSERT INTO categories (name, color, keywords) VALUES (?, ?, ?)')
    .run(name, color, JSON.stringify(keywords))
  return Number(result.lastInsertRowid)
}

/**
 * カテゴリを更新する。
 *
 * @param db - Database インスタンス
 * @param id - カテゴリ ID
 * @param name - カテゴリ名
 * @param color - カラーコード
 * @param keywords - マッチングキーワード一覧
 */
export function updateCategory(
  db: Database.Database,
  id: number,
  name: string,
  color: string,
  keywords: string[]
): void {
  db.prepare(
    'UPDATE categories SET name = ?, color = ?, keywords = ? WHERE id = ?'
  ).run(name, color, JSON.stringify(keywords), id)
}

/**
 * カテゴリを削除する（tweet_categories も CASCADE 削除）。
 *
 * @param db - Database インスタンス
 * @param id - カテゴリ ID
 */
export function deleteCategory(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id)
}

/**
 * マッチング用にすべてのカテゴリのキーワードリストを取得する。
 *
 * @param db - Database インスタンス
 * @returns id と keywords の配列
 */
export function getCategoryKeywords(
  db: Database.Database
): { id: number; keywords: string[] }[] {
  const rows = db.prepare('SELECT id, keywords FROM categories').all() as {
    id: number
    keywords: string
  }[]

  return rows.map((row) => ({
    id: row.id,
    keywords: JSON.parse(row.keywords) as string[],
  }))
}

/**
 * IDF（逆文書頻度）ベースのノイズタグを一括削除する。
 * 解析済みツイート総数に対して threshold 以上の割合に出現するタグは
 * 汎用語とみなして tweet_tags から削除し、孤立した tags レコードも削除する。
 *
 * @param db - Database インスタンス
 * @param threshold - 出現割合の閾値（例: 0.1 = 全ツイートの 10% 以上に出現したら除去）
 * @returns 削除した tweet_tags レコード数
 */
export function pruneNoiseTags(
  db: Database.Database,
  threshold: number
): number {
  // tweet_tags に登録されたツイート総数（タグ付き = 解析済みツイート）
  const totalRow = db
    .prepare('SELECT COUNT(DISTINCT tweet_id) AS cnt FROM tweet_tags')
    .get() as { cnt: number }
  const totalTweets = totalRow.cnt
  if (totalTweets === 0) return 0

  // ノイズ判定の最低出現件数（threshold 未満なら除去対象としない）
  const minDocCount = Math.ceil(totalTweets * threshold)
  if (minDocCount < 2) return 0

  // threshold 以上の割合に出現するタグの tweet_tags レコードを削除する
  const result = db
    .prepare(
      `
      DELETE FROM tweet_tags
      WHERE tag_id IN (
        SELECT tag_id
        FROM tweet_tags
        GROUP BY tag_id
        HAVING COUNT(DISTINCT tweet_id) >= ?
      )
      `
    )
    .run(minDocCount)

  // 孤立した tags レコードを削除する
  db.prepare(
    'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM tweet_tags)'
  ).run()

  return result.changes
}

/**
 * 頻出タグ一覧を取得する。
 *
 * @param db - Database インスタンス
 * @param limit - 上限件数
 * @returns タグアイテムの配列（出現数降順）
 */
export function getTopTags(db: Database.Database, limit: number): TagItem[] {
  const rows = db
    .prepare(
      `
      SELECT t.id, t.name, COUNT(tt.tweet_id) AS count
      FROM tags t
      INNER JOIN tweet_tags tt ON t.id = tt.tag_id
      GROUP BY t.id
      ORDER BY count DESC
      LIMIT ?
      `
    )
    .all(limit) as { id: number; name: string; count: number }[]

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    count: row.count,
  }))
}
