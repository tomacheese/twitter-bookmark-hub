import fs from 'node:fs'
import path from 'node:path'
import {
  Scraper,
  randomizeBrowserProfile,
} from '@the-convocation/twitter-scraper'
import { DATA_DIR } from '../shared/config.js'
import { sleep } from '../shared/retry.js'
import type { AccountConfig, CachedCookies } from '../shared/types.js'
import { cycleTLSFetch } from './cycletls.js'
import { Logger } from './logger.js'

const logger = Logger.configure('auth')

/** Cookie の有効期間 (日) */
const COOKIE_EXPIRY_DAYS = 7

/**
 * 環境変数から直接 Cookie を取得する。
 * TWITTER_AUTH_TOKEN と TWITTER_CT0 が設定されている場合はそれを使う。
 * @returns Cookie または null
 */
export function getCookiesFromEnv(): { authToken: string; ct0: string } | null {
  const authToken = process.env.TWITTER_AUTH_TOKEN
  const ct0 = process.env.TWITTER_CT0
  if (authToken && ct0) {
    return { authToken, ct0 }
  }
  return null
}

/**
 * Cookie キャッシュファイルのパスを返す。
 * @param username アカウントのユーザー名
 * @returns ファイルパス
 */
function cookieCachePath(username: string): string {
  return path.join(DATA_DIR, `cookies-${username}.json`)
}

/**
 * Cookie キャッシュを読み込む。期限切れや不正な場合は null を返す。
 * @param username アカウントのユーザー名
 * @returns キャッシュ済み Cookie または null
 */
export function loadCachedCookies(username: string): CachedCookies | null {
  const filePath = cookieCachePath(username)
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const data: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).auth_token !== 'string' ||
      typeof (data as Record<string, unknown>).ct0 !== 'string' ||
      typeof (data as Record<string, unknown>).savedAt !== 'number'
    ) {
      logger.warn(`[${username}] Invalid cookie cache format. Re-logging in.`)
      return null
    }
    const cached = data as CachedCookies
    const expiryMs = COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() - cached.savedAt > expiryMs) {
      logger.log(`[${username}] Cookie cache expired. Re-logging in.`)
      return null
    }
    return cached
  } catch (error) {
    logger.warn(`[${username}] Failed to read cookie cache:`, error)
    return null
  }
}

/**
 * Cookie をキャッシュファイルに保存する。
 * @param username アカウントのユーザー名
 * @param authToken auth_token の値
 * @param ct0 ct0 の値
 */
export function saveCookies(
  username: string,
  authToken: string,
  ct0: string
): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  const data: CachedCookies = {
    auth_token: authToken,
    ct0,
    savedAt: Date.now(),
  }
  fs.writeFileSync(cookieCachePath(username), JSON.stringify(data, null, 2))
}

/**
 * Scraper インスタンスを生成する。
 * 試行ごとにブラウザ指紋をランダム化してフィンガープリントによる拒否を回避する。
 *
 * @param options 生成オプション
 * @param options.xpff x-xp-forwarded-for ヘッダーを有効にするか（デフォルト: false）
 * @returns Scraper インスタンス
 */
export function createScraper(options: { xpff?: boolean } = {}): Scraper {
  const browserProfile = randomizeBrowserProfile()

  return new Scraper({
    fetch: cycleTLSFetch,
    experimental: {
      // xClientTransactionId は x.com HTML のキー解析に失敗するため無効化
      xClientTransactionId: false,
      // x-xp-forwarded-for: ブラウザ追跡ヘッダー
      xpff: options.xpff ?? false,
      // ステップ間の遅延を人間らしい値に設定 (2〜5 秒)
      flowStepDelay: 2000 + Math.floor(Math.random() * 3000),
      browserProfile,
    },
  })
}

/** ログイン 1 試行分の戦略定義 */
interface LoginStrategy {
  /** ログイン識別子の種別 */
  identifierType: 'email' | 'username'
  /** x-xp-forwarded-for ヘッダーを有効にするか */
  xpff: boolean
}

/**
 * ログイン試行順序の定義。
 * 成功率が高い組み合わせを先頭に配置し、以降は実績に基づいて交互に試行する。
 * maxAttempts が配列長を超えた場合は先頭から繰り返す。
 */
const LOGIN_STRATEGIES: readonly LoginStrategy[] = [
  { identifierType: 'email', xpff: false },
  { identifierType: 'email', xpff: true },
  { identifierType: 'username', xpff: true },
  { identifierType: 'email', xpff: true },
  { identifierType: 'username', xpff: true },
  { identifierType: 'email', xpff: true },
]

/**
 * ログイン処理を複数の戦略でリトライする。
 * - 503 エラー: 指数バックオフ
 * - 399 エラー: 120 秒待機
 * - DenyLoginSubtask: 識別子・xpff を戦略に従って切り替えてリトライ
 *
 * @param account アカウント情報
 * @param maxAttempts 最大試行回数
 * @returns ログイン済みの Scraper インスタンス
 */
export async function loginWithRetry(
  account: AccountConfig,
  maxAttempts = 6
): Promise<Scraper> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const strategy = LOGIN_STRATEGIES[(attempt - 1) % LOGIN_STRATEGIES.length]
    const identifier =
      strategy.identifierType === 'email' ? account.email : account.username
    const scraper = createScraper({ xpff: strategy.xpff })

    try {
      logger.log(
        `[${account.username}] Login attempt ${attempt}/${maxAttempts} (identifier: ${strategy.identifierType}, xpff: ${strategy.xpff})...`
      )
      await scraper.login(
        identifier,
        account.password,
        account.email,
        account.otp_secret ?? undefined
      )
      return scraper
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const is503 =
        message.includes('503') || message.includes('Service Unavailable')
      const is399 = /\b399\b/.test(message)
      const isDeny = message.includes('DenyLoginSubtask')

      if (attempt >= maxAttempts) {
        throw error
      }

      if (is503) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000)
        logger.warn(
          `[${account.username}] 503 error. Retrying in ${delay / 1000}s...`
        )
        await sleep(delay)
      } else if (is399) {
        logger.warn(
          `[${account.username}] Error 399 (suspicious activity detected). Retrying in 120s...`
        )
        await sleep(120_000)
      } else if (isDeny) {
        const delay = 3000 + Math.floor(Math.random() * 2000)
        logger.warn(
          `[${account.username}] DenyLoginSubtask. Retrying with different strategy in ${delay / 1000}s...`
        )
        await sleep(delay)
      } else {
        throw error
      }
    }
  }

  throw new Error(
    `[${account.username}] Login failed after ${maxAttempts} attempts.`
  )
}

/**
 * Cookie を取得する。以下の優先順で取得する:
 * 1. 環境変数 TWITTER_AUTH_TOKEN / TWITTER_CT0
 * 2. Cookie キャッシュファイル
 * 3. twitter-scraper でログイン
 *
 * @param account アカウント情報
 * @returns auth_token と ct0
 */
export async function getAuthCookies(
  account: AccountConfig
): Promise<{ authToken: string; ct0: string }> {
  // 環境変数から Cookie を取得 (手動設定用)
  const fromEnv = getCookiesFromEnv()
  if (fromEnv) {
    logger.log(
      `[${account.username}] Using cookies from environment variables.`
    )
    return fromEnv
  }

  // キャッシュファイルから Cookie を取得
  const cached = loadCachedCookies(account.username)
  if (cached) {
    logger.log(`[${account.username}] Using cached cookies.`)
    return { authToken: cached.auth_token, ct0: cached.ct0 }
  }

  // twitter-scraper でログイン
  logger.log(
    `[${account.username}] Logging in with twitter-scraper + CycleTLS...`
  )
  const scraper = await loginWithRetry(account)

  if (!(await scraper.isLoggedIn())) {
    throw new Error(`[${account.username}] Login failed.`)
  }

  const cookies = await scraper.getCookies()
  const authToken = cookies.find((c) => c.key === 'auth_token')?.value
  const ct0 = cookies.find((c) => c.key === 'ct0')?.value

  if (!authToken || !ct0) {
    throw new Error(
      `[${account.username}] Failed to retrieve auth_token or ct0.`
    )
  }

  saveCookies(account.username, authToken, ct0)
  logger.log(`[${account.username}] Login successful. Cookies saved.`)
  return { authToken, ct0 }
}
