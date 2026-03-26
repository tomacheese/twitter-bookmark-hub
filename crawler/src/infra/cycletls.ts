import initCycleTLS, { type CycleTLSClient } from 'cycletls'
import { cycleTLSExit } from '@the-convocation/twitter-scraper/cycletls'
import { Headers } from 'headers-polyfill'

// ===== CycleTLS シングルトン =====

let cycleTLSInstancePromise: Promise<CycleTLSClient> | null = null

/**
 * CycleTLS クライアントをシングルトンで初期化して返す。
 * @returns CycleTLS クライアント
 */
export async function getCycleTLSInstance(): Promise<CycleTLSClient> {
  cycleTLSInstancePromise ??= initCycleTLS()
  return cycleTLSInstancePromise
}

/**
 * CycleTLS 経由で HTTP リクエストを送信する fetch 互換関数。
 * TLS フィンガープリント (JA3) を Chrome に偽装して Twitter のボット検出を回避する。
 *
 * @param input リクエスト URL
 * @param init リクエストオプション
 * @returns レスポンス
 */
export async function cycleTLSFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const instance = await getCycleTLSInstance()

  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  const method = (init?.method ?? 'GET').toUpperCase()

  // ヘッダーを Record<string, string> に正規化
  const headers: Record<string, string> = {}
  if (init?.headers) {
    const h = init.headers as {
      entries?: () => IterableIterator<[string, string]>
      [Symbol.iterator]?: () => Iterator<[string, string]>
    }
    if (h.entries && typeof h.entries === 'function') {
      for (const [key, value] of h.entries()) {
        headers[key] = value
      }
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value
      }
    } else {
      Object.assign(headers, init.headers as Record<string, string>)
    }
  }

  // ボディを文字列に変換
  let body: string | undefined
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = init.body
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString()
      if (!headers['content-type']) {
        headers['content-type'] =
          'application/x-www-form-urlencoded;charset=UTF-8'
      }
    } else {
      body = JSON.stringify(init.body)
    }
  }

  // プロキシ設定 (環境変数 PROXY_SERVER があれば使用)
  let proxy: string | undefined
  const proxyServer = process.env.PROXY_SERVER
  if (proxyServer) {
    const normalized =
      proxyServer.startsWith('http://') || proxyServer.startsWith('https://')
        ? proxyServer
        : `http://${proxyServer}`
    const proxyUsername = process.env.PROXY_USERNAME
    const proxyPassword = process.env.PROXY_PASSWORD
    if (proxyUsername && proxyPassword) {
      const proxyUrl = new URL(normalized)
      proxyUrl.username = proxyUsername
      proxyUrl.password = proxyPassword
      proxy = proxyUrl.toString()
    } else {
      proxy = normalized
    }
  }

  const options: Record<string, unknown> = {
    body,
    headers,
    // JA3 フィンガープリント: Chrome 120 on Windows 10
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
    userAgent:
      headers['user-agent'] ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  }
  if (proxy !== undefined) {
    options.proxy = proxy
  }

  const response = await instance(
    url,
    options,
    method.toLowerCase() as 'head' | 'get' | 'post' | 'put' | 'delete' | 'patch'
  )

  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        responseHeaders.append(key, v)
      }
    } else if (typeof value === 'string') {
      responseHeaders.set(key, value)
    }
  }

  // CycleTLS はバイナリレスポンスを Node.js の Buffer オブジェクトとして返すことがある。
  // その場合は UTF-8 文字列に変換する。JSON でシリアライズすると壊れるため要注意。
  const responseBody = (() => {
    if (response.data == null) return ''
    if (typeof response.data === 'string') return response.data
    if (Buffer.isBuffer(response.data)) {
      return response.data.toString('utf8')
    }
    return JSON.stringify(response.data)
  })()

  return new Response(responseBody, {
    status: response.status,
    statusText: '',
    headers: responseHeaders,
  })
}

/**
 * CycleTLS のリソースをクリーンアップする。
 * 自前のシングルトンインスタンスと twitter-scraper 内部のインスタンスの両方を終了する。
 * プロセス終了時に呼び出す。
 */
export async function cleanupCycleTLS(): Promise<void> {
  if (cycleTLSInstancePromise) {
    try {
      const instance = await cycleTLSInstancePromise
      await instance.exit()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`CycleTLS cleanup error: ${message}`)
    }
  }
  try {
    // twitter-scraper 内部の CycleTLS シングルトンもクリーンアップする
    cycleTLSExit()
  } catch {
    // twitter-scraper 内部の CycleTLS が未初期化の場合は無視
  }
}
