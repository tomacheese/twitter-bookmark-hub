import type Database from 'better-sqlite3'
import { Hono } from 'hono'
import { isRunning, runCrawl } from './core/crawler.js'
import { getLatestCrawlJob } from './infra/database.js'

/**
 * HTTP API サーバーを作成する。
 *
 * @param db Database インスタンス
 * @returns Hono アプリケーション
 */
export function createServer(db: Database.Database): Hono {
  const app = new Hono()

  /** ヘルスチェックエンドポイント */
  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  /** クロール手動実行エンドポイント */
  app.post('/crawl', (c) => {
    if (isRunning()) {
      return c.json({ error: 'Crawl is already running.' }, 409)
    }
    // 非同期で実行 (レスポンスは即座に返す)
    runCrawl(db).catch((error: unknown) => {
      console.error('Manual crawl failed unexpectedly:', error)
    })
    return c.json({ message: 'Crawl started.' }, 202)
  })

  /** クロールステータス取得エンドポイント */
  app.get('/crawl/status', (c) => {
    const job = getLatestCrawlJob(db)
    // ジョブが存在しない場合は null を返してレスポンス型を固定する
    return c.json(job)
  })

  return app
}
