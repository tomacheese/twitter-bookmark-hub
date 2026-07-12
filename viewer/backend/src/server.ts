import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import type Database from 'better-sqlite3'
import { bookmarksRoute } from './routes/bookmarks'
import { accountsRoute } from './routes/accounts'
import { crawlRoute } from './routes/crawl'
import { featuresRoute } from './routes/features'
import { analyzerProxyRoute } from './routes/proxy'

/**
 * Hono サーバーを作成する
 * @param database - Database インスタンス
 * @returns 設定済みの Hono アプリケーション
 */
export function createServer(database: Database.Database): Hono {
  const app = new Hono()

  // video.twimg.com のホットリンク保護を回避するために Referer を送らないよう指示する
  app.use(async (c, next) => {
    await next()
    c.header('Referrer-Policy', 'no-referrer')
  })

  // API ルートをマウント
  app.route('/', bookmarksRoute(database))
  app.route('/', accountsRoute(database))
  app.route('/', crawlRoute(database))
  app.route('/', featuresRoute())
  app.route('/', analyzerProxyRoute())

  // 未マッチの /api/* リクエストは 404 を返し、SPA フォールバックに渡さない
  app.all('/api/*', (c) => c.notFound())

  // 静的ファイル配信
  app.use('/*', serveStatic({ root: './public' }))

  // SPA フォールバック
  app.use('/*', serveStatic({ path: './public/index.html' }))

  return app
}
