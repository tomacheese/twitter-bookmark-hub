import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type Database from 'better-sqlite3'
import { getLatestCrawlJob } from '../infra/database.js'

/** クローラーサービスの URL */
const CRAWLER_URL = process.env.CRAWLER_URL ?? 'http://crawler:3001'

/**
 * クロール API ルートを作成する
 * @param db - Database インスタンス
 * @returns Hono アプリケーション
 */
export function crawlRoute(db: Database.Database): Hono {
  const app = new Hono()

  /** GET /api/crawl/status - クロールステータスをローカル DB から取得する。クロール未実行時は null を返す */
  app.get('/api/crawl/status', (c) => {
    const job = getLatestCrawlJob(db)
    return c.json(job)
  })

  /** POST /api/crawl/trigger - クロールを開始する */
  app.post('/api/crawl/trigger', async (c) => {
    try {
      const res = await fetch(`${CRAWLER_URL}/crawl`, { method: 'POST' })
      // Content-Type が JSON でない場合（エラーページ等）に res.json() が例外になるのを防ぐ
      const contentType = res.headers.get('content-type') ?? ''
      const data: unknown = contentType.includes('application/json')
        ? await res.json()
        : { message: await res.text() }
      return c.json(data, res.status as ContentfulStatusCode)
    } catch {
      return c.json({ error: 'Crawler service is unavailable.' }, 502)
    }
  })

  return app
}
