import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import type { KuromojiTokenizer } from './core/tagger'
import { analyzeRoute } from './routes/analyze'
import { categoriesRoute } from './routes/categories'
import { tagsRoute } from './routes/tags'

/**
 * Hono サーバーを作成する
 * @param database - Database インスタンス
 * @param tokenizer - kuromoji トークナイザー
 * @returns 設定済みの Hono アプリケーション
 */
export function createServer(
  database: Database.Database,
  tokenizer: KuromojiTokenizer
): Hono {
  const app = new Hono()

  app.route('/', analyzeRoute(database, tokenizer))
  app.route('/', categoriesRoute(database))
  app.route('/', tagsRoute(database))

  app.get('/health', (c) =>
    c.json({ status: 'ok', timestamp: new Date().toISOString() })
  )

  return app
}
