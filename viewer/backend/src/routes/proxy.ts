import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * analyzer プロキシハンドラー。
 * /api/categories, /api/tags のリクエストを analyzer に転送する。
 *
 * @param c - Hono コンテキスト
 * @returns レスポンス
 */
const proxyHandler = async (c: Context) => {
  const analyzerUrl = process.env.ANALYZER_URL
  if (!analyzerUrl) {
    return c.json({ error: 'Analyzer service is not configured' }, 503)
  }

  // /api/categories → /categories のようにプレフィックスを除去する
  const path = c.req.path.replace(/^\/api/, '')
  const url = `${analyzerUrl}${path}${c.req.url.includes('?') ? '?' + new URL(c.req.url).searchParams.toString() : ''}`

  const init: RequestInit = {
    method: c.req.method,
    headers: { 'Content-Type': 'application/json' },
  }

  if (c.req.method !== 'GET' && c.req.method !== 'DELETE') {
    init.body = await c.req.text()
  }

  const upstream = await fetch(url, init)
  const body = await upstream.text()

  return new Response(body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * analyzer サービスへのプロキシルートを作成する。
 * ANALYZER_URL が設定されている場合は analyzer にリクエストを転送する。
 * 未設定の場合は 503 を返す。
 *
 * @returns Hono アプリケーション
 */
export function analyzerProxyRoute(): Hono {
  const app = new Hono()

  app.all('/api/categories', proxyHandler)
  app.all('/api/categories/:id', proxyHandler)
  app.all('/api/tags', proxyHandler)

  return app
}
