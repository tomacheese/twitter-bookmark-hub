import fs from 'node:fs'
import path from 'node:path'
import {
  Scraper,
  randomizeBrowserProfile,
} from '@the-convocation/twitter-scraper'
import { DATA_DIR } from '../shared/config'
import { sleep } from '../shared/retry'
import type { AccountConfig, CachedCookies } from '../shared/types'
import { cycleTLSFetch } from './cycletls'
import { Logger } from '@book000/node-utils'

const logger = Logger.configure('auth')

/** Cookie の有効期間 (日) */
const COOKIE_EXPIRY_DAYS = 7

/** Cookie issuer の応答待機時間 (ミリ秒) */
const COOKIE_ISSUER_TIMEOUT_MS = 300_000

/** 399 発生後に同じアカウントの認証情報ログインを止める時間 (ミリ秒) */
const LOGIN_399_COOLDOWN_MS = 5 * 60 * 1000

/** アカウントごとの 399 ログイン抑止期限 */
const login399Cooldowns = new Map<string, number>()

/**
 * 環境変数からアカウント別 Cookie を取得する。
 * TWITTER_AUTH_TOKEN_{USERNAME} / TWITTER_CT0_{USERNAME} を参照する。
 *
 * @param username アカウントのユーザー名
 * @returns Cookie または null
 */
export function getCookiesFromEnv(
  username: string
): { authToken: string; ct0: string } | null {
  // Twitter のユーザー名は [A-Za-z0-9_] のみのため toUpperCase() で十分
  const envSuffix = username.toUpperCase()
  const authToken = process.env[`TWITTER_AUTH_TOKEN_${envSuffix}`]
  const ct0 = process.env[`TWITTER_CT0_${envSuffix}`]
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
      logger.info(`[${username}] Cookie cache expired. Re-logging in.`)
      return null
    }
    return cached
  } catch (error) {
    logger.warn(
      `[${username}] Failed to read cookie cache:`,
      error instanceof Error ? error : new Error(String(error))
    )
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
 * 設定済みの Cookie issuer から Cookie を取得する。issuer の失敗時は null を返す。
 * @param account アカウント情報
 * @returns Cookie または null
 */
async function getCookiesFromIssuer(
  account: AccountConfig
): Promise<{ authToken: string; ct0: string } | null> {
  const issuerUrl = process.env.TWITTER_COOKIE_ISSUER_URL
  if (!issuerUrl) {
    return null
  }

  try {
    const response = await fetch(`${issuerUrl.replace(/\/$/, '')}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: account.username,
        password: account.password,
        ...(account.otp_secret && { otp_secret: account.otp_secret }),
      }),
      signal: AbortSignal.timeout(COOKIE_ISSUER_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn(`[${account.username}] Cookie issuer request failed.`)
      return null
    }

    const data: unknown = await response.json()
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).auth_token !== 'string' ||
      typeof (data as Record<string, unknown>).ct0 !== 'string'
    ) {
      logger.warn(
        `[${account.username}] Cookie issuer returned invalid cookies.`
      )
      return null
    }

    const cookies = data as { auth_token: string; ct0: string }
    return { authToken: cookies.auth_token, ct0: cookies.ct0 }
  } catch {
    logger.warn(`[${account.username}] Cookie issuer request failed.`)
    return null
  }
}

/**
 * アカウントの認証情報ログインが 399 のクールダウン中かを返す。
 * @param username アカウントのユーザー名
 * @returns クールダウン中か
 */
function isLogin399CooldownActive(username: string): boolean {
  const expiresAt = login399Cooldowns.get(username)
  if (!expiresAt) {
    return false
  }
  if (expiresAt > Date.now()) {
    return true
  }
  login399Cooldowns.delete(username)
  return false
}

/**
 * エラーが X の 399 を示すかを返す。
 * @param error 発生したエラー
 * @returns 399 エラーか
 */
function isXError399(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } }).response?.status
  return status === 399 || /\b399\b/.test(String(error))
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
 * - 399 エラー: 同じ呼び出しではリトライせず、アカウントを一時的に抑止
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
      logger.info(
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
      const is399 = isXError399(error)
      if (is399) {
        login399Cooldowns.set(
          account.username,
          Date.now() + LOGIN_399_COOLDOWN_MS
        )
        logger.warn(
          `[${account.username}] X error 399. Credential login is temporarily suppressed.`
        )
        throw new Error(
          `[${account.username}] X login was rejected with error 399.`
        )
      }

      if (attempt >= maxAttempts) {
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)
      const is503 =
        message.includes('503') || message.includes('Service Unavailable')
      const isDeny = message.includes('DenyLoginSubtask')

      if (is503) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000)
        logger.warn(
          `[${account.username}] 503 error. Retrying in ${delay / 1000}s...`
        )
        await sleep(delay)
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
 * 3. 設定済み Cookie issuer
 * 4. twitter-scraper でログイン
 *
 * @param account アカウント情報
 * @returns auth_token と ct0
 */
export async function getAuthCookies(
  account: AccountConfig
): Promise<{ authToken: string; ct0: string }> {
  // 環境変数から Cookie を取得 (手動設定用)
  const fromEnv = getCookiesFromEnv(account.username)
  if (fromEnv) {
    logger.info(
      `[${account.username}] Using cookies from environment variables.`
    )
    return fromEnv
  }

  // キャッシュファイルから Cookie を取得
  const cached = loadCachedCookies(account.username)
  if (cached) {
    logger.info(`[${account.username}] Using cached cookies.`)
    return { authToken: cached.auth_token, ct0: cached.ct0 }
  }

  // 設定済み Cookie issuer から取得
  const fromIssuer = await getCookiesFromIssuer(account)
  if (fromIssuer) {
    saveCookies(account.username, fromIssuer.authToken, fromIssuer.ct0)
    logger.info(`[${account.username}] Cookie issuer succeeded. Cookies saved.`)
    return fromIssuer
  }

  if (isLogin399CooldownActive(account.username)) {
    throw new Error(
      `[${account.username}] Credential login is temporarily unavailable due to a recent X error 399 cooldown.`
    )
  }

  // twitter-scraper でログイン
  logger.info(
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
  logger.info(`[${account.username}] Login successful. Cookies saved.`)
  return { authToken, ct0 }
}
