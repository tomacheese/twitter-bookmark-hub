import { Hono } from 'hono'
import type { FeaturesResponse } from '@twitter-bookmark-hub/shared'

/**
 * 機能フラグ API ルートを作成する
 * @returns Hono アプリケーション
 */
export function featuresRoute(): Hono {
  const app = new Hono()

  /** GET /api/features - 有効な機能フラグを返す */
  app.get('/api/features', (c) => {
    const response: FeaturesResponse = {
      analyzer: !!process.env.ANALYZER_URL,
    }
    return c.json(response)
  })

  return app
}
