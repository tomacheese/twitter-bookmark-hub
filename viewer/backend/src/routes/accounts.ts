import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import { getAccounts } from '../infra/database'

/**
 * アカウント API ルートを作成する
 * @param db - Database インスタンス
 * @returns Hono アプリケーション
 */
export function accountsRoute(db: Database.Database): Hono {
  const app = new Hono()

  /** GET /api/accounts - アカウント一覧を取得する */
  app.get('/api/accounts', (c) => {
    const accounts = getAccounts(db)
    return c.json(accounts)
  })

  return app
}
