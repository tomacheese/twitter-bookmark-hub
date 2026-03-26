import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import { getBookmarks } from '../infra/database.js'
import type { BookmarksResponse } from '../shared/types.js'

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

    const result = getBookmarks(db, { page, limit, q, account, sort, sortBy })

    const response: BookmarksResponse = {
      items: result.items,
      total: result.total,
      page,
      limit,
    }

    return c.json(response)
  })

  return app
}
