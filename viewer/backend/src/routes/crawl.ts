import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type Database from 'better-sqlite3'
import { getLatestCrawlJob } from '../infra/database'
import { CRAWLER_URL } from '../shared/config'

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
    // 30 秒でタイムアウトし、ハングした接続でリクエストがブロックされるのを防ぐ
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, 30_000)
    try {
      const res = await fetch(`${CRAWLER_URL}/crawl`, {
        method: 'POST',
        signal: controller.signal,
      })
      // Content-Type が JSON でない場合（エラーページ等）に res.json() が例外になるのを防ぐ
      const contentType = res.headers.get('content-type') ?? ''
      const data: unknown = contentType.includes('application/json')
        ? await res.json()
        : { message: await res.text() }
      return c.json(data, res.status as ContentfulStatusCode)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return c.json({ error: 'Crawler service timed out.' }, 504)
      }
      return c.json({ error: 'Crawler service is unavailable.' }, 502)
    } finally {
      clearTimeout(timer)
    }
  })

  return app
}
