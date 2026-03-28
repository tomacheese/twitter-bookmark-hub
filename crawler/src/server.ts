import type Database from 'better-sqlite3'
import { Hono } from 'hono'
import { isRunning, runCrawl } from './core/crawler'
import {
  addBookmark,
  getBookmarksClient,
  removeBookmark,
} from './infra/bookmarks-api'
import { getAuthCookies } from './infra/auth'
import { deleteBookmark, getLatestCrawlJob } from './infra/database'
import { loadConfig } from './shared/config'

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

  /** ブックマーク追加エンドポイント */
  app.post('/bookmarks', async (c) => {
    let body: { account?: string; tweetId?: string }
    try {
      body = await c.req.json<{ account?: string; tweetId?: string }>()
    } catch {
      return c.json({ error: 'Invalid JSON body.' }, 400)
    }
    const { account, tweetId } = body
    if (!account || !tweetId) {
      return c.json({ error: 'account and tweetId are required.' }, 400)
    }

    let config
    try {
      config = loadConfig()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: `Failed to load config: ${message}` }, 500)
    }

    const accountConfig = config.twitter.accounts.find(
      (a) => a.username === account
    )
    if (!accountConfig) {
      return c.json({ error: `Account not found: ${account}` }, 404)
    }

    try {
      const { authToken, ct0 } = await getAuthCookies(accountConfig)
      const client = await getBookmarksClient(authToken, ct0)
      await addBookmark(client, tweetId)
      return c.json({ message: 'Bookmark added.' })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: `Failed to add bookmark: ${message}` }, 500)
    }
  })

  /** ブックマーク削除エンドポイント */
  app.delete('/bookmarks/:tweetId', async (c) => {
    const tweetId = c.req.param('tweetId')
    const account = c.req.query('account')
    if (!account) {
      return c.json({ error: 'account query parameter is required.' }, 400)
    }

    let config
    try {
      config = loadConfig()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: `Failed to load config: ${message}` }, 500)
    }

    const accountConfig = config.twitter.accounts.find(
      (a) => a.username === account
    )
    if (!accountConfig) {
      return c.json({ error: `Account not found: ${account}` }, 404)
    }

    try {
      const { authToken, ct0 } = await getAuthCookies(accountConfig)
      const client = await getBookmarksClient(authToken, ct0)
      await removeBookmark(client, tweetId)
      deleteBookmark(db, tweetId, account)
      return c.json({ message: 'Bookmark deleted.' })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: `Failed to delete bookmark: ${message}` }, 500)
    }
  })

  return app
}
