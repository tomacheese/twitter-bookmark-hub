import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type Database from 'better-sqlite3'
import { getBookmarks } from '../infra/database'
import type { BookmarksResponse } from '../shared/types'

/** クローラーサービスの URL */
const CRAWLER_URL = process.env.CRAWLER_URL ?? 'http://crawler:3001'

/**
 * ブックマーク API ルートを作成する
 * @param db - Database インスタンス
 * @returns Hono アプリケーション
 */
export function bookmarksRoute(db: Database.Database): Hono {
  const app = new Hono()

  /** GET /api/bookmarks - ブックマーク一覧を取得する */
  app.get('/api/bookmarks', (c) => {
    const rawPage = Number(c.req.query('page') ?? '1')
    const rawLimit = Number(c.req.query('limit') ?? '20')
    const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1)
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20)
    )
    const rawQ = c.req.query('q')
    const q: string | undefined = rawQ === '' ? undefined : rawQ
    const rawAccount = c.req.query('account')
    const account: string | undefined =
      rawAccount === '' ? undefined : rawAccount
    const rawSort = c.req.query('sort')
    const sort: 'asc' | 'desc' = rawSort === 'asc' ? 'asc' : 'desc'
    const rawSortBy = c.req.query('sort_by')
    const sortBy: 'bookmarked_at' | 'created_at' =
      rawSortBy === 'created_at' ? 'created_at' : 'bookmarked_at'

    const rawCategory = c.req.query('category')
    let categoryId: number | undefined
    if (rawCategory !== undefined && rawCategory !== '') {
      const parsedCategory = Number(rawCategory)
      if (Number.isInteger(parsedCategory) && parsedCategory >= 1) {
        categoryId = parsedCategory
      }
    }

    const rawTag = c.req.query('tag')
    const tag: string | undefined = rawTag === '' ? undefined : rawTag

    const result = getBookmarks(db, {
      page,
      limit,
      q,
      account,
      sort,
      sortBy,
      categoryId,
      tag,
    })

    const response: BookmarksResponse = {
      items: result.items,
      total: result.total,
      page,
      limit,
    }

    return c.json(response)
  })

  /** DELETE /api/bookmarks/:tweetId - ブックマークを解除する（クローラーに転送） */
  app.delete('/api/bookmarks/:tweetId', async (c) => {
    const tweetId = c.req.param('tweetId')
    const account = c.req.query('account')
    if (!account) {
      return c.json({ error: 'account query parameter is required.' }, 400)
    }

    // 30 秒でタイムアウトし、ハングした接続でリクエストがブロックされるのを防ぐ
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, 30_000)
    try {
      const url = new URL(
        `${CRAWLER_URL}/bookmarks/${encodeURIComponent(tweetId)}`
      )
      url.searchParams.set('account', account)
      const res = await fetch(url.toString(), {
        method: 'DELETE',
        signal: controller.signal,
      })
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
