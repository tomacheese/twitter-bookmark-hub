import type Database from 'better-sqlite3'
import type {
  TwitterOpenApiClient,
  TweetApiUtilsData,
} from 'twitter-openapi-typescript'
import type { AccountConfig } from '../shared/types'
import { loadConfig } from '../shared/config'
import { withRetry } from '../shared/retry'
import { getAuthCookies } from '../infra/auth'
import {
  extractBookmarkEntry,
  getBookmarksClient,
} from '../infra/bookmarks-api'
import {
  createCrawlJob,
  updateCrawlJob,
  upsertTweetEntry,
  upsertBookmark,
  deleteBookmark,
  getBookmarkTweetIds,
  upsertTweetTags,
  upsertTweetCategories,
  saveCrawlAccountResult,
} from '../infra/database'
import { Logger } from '@book000/node-utils'

const logger = Logger.configure('crawler')

/**
 * クロール後に analyzer へ IDF ノイズプルーニングを依頼する。
 * ANALYZER_URL が設定されていない場合は何もしない。
 * プルーニングの失敗はログに記録するが、クロール全体は続行する。
 *
 * @param threshold IDF 閾値（デフォルト 0.1）
 */
async function pruneNoiseTagsViaAnalyzer(threshold = 0.1): Promise<void> {
  const analyzerUrl = process.env.ANALYZER_URL
  if (!analyzerUrl) return

  try {
    const response = await fetch(
      `${analyzerUrl}/analyze/prune-noise?threshold=${threshold}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      }
    )
    if (!response.ok) {
      logger.warn(`Prune-noise returned non-OK status: ${response.status}`)
      return
    }
    const result = (await response.json()) as {
      deleted?: number
      threshold?: number
    }
    logger.info(
      `Prune-noise completed: deleted ${result.deleted ?? 0} tweet_tags entries (threshold=${result.threshold ?? threshold})`
    )
  } catch (error) {
    logger.warn(
      'Failed to prune noise tags:',
      error instanceof Error ? error : new Error(String(error))
    )
  }
}

/**
 * analyzer に分析を依頼し、結果をデータベースに保存する。
 * ANALYZER_URL が設定されていない場合は何もしない。
 * 分析の失敗はログに記録するが、クロール全体は続行する。
 *
 * @param database Database インスタンス
 * @param tweetId ツイート ID
 * @param text 分析対象テキスト
 */
async function analyzeAndSave(
  database: Database.Database,
  tweetId: string,
  text: string
): Promise<void> {
  const analyzerUrl = process.env.ANALYZER_URL
  if (!analyzerUrl) return

  try {
    const response = await fetch(`${analyzerUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId, text }),
      // analyzer が応答しない場合にクロール全体がハングしないよう 10 秒でタイムアウトする
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      logger.warn(
        `Analyzer returned non-OK status for tweet ${tweetId}: ${response.status}`
      )
      return
    }

    const result = (await response.json()) as {
      tags?: string[]
      categories?: { id: number; confidence: number }[]
    }

    if (Array.isArray(result.tags)) {
      upsertTweetTags(database, tweetId, result.tags)
    }
    if (Array.isArray(result.categories)) {
      upsertTweetCategories(database, tweetId, result.categories)
    }
  } catch (error) {
    logger.warn(
      `Failed to analyze tweet ${tweetId}:`,
      error instanceof Error ? error : new Error(String(error))
    )
  }
}

/** ブックマーク取得の 1 ページあたり件数 */
const BOOKMARKS_PER_PAGE = 100

/** ページ内の analyzer 呼び出しの最大同時実行数（過負荷防止） */
const ANALYZER_CONCURRENCY = 10

/** 1 回のクロールで取得するページ数の上限（API 異常時の無限ループ防止） */
const MAX_PAGES = 500

// トップレベル変数への関数内代入 (unicorn/no-top-level-assignment-in-function) を避けるため、
// クロール実行中フラグはオブジェクトのプロパティとして保持する
const crawlState = { isRunning: false }

/**
 * クロールが実行中かどうかを返す。
 * @returns 実行中なら true
 */
export function isRunning(): boolean {
  return crawlState.isRunning
}

/**
 * エラーオブジェクトからエラー種別を分類する。
 * 認証エラー ('auth') は呼び出し元で個別に捕捉するため、このヘルパーの対象外。
 *
 * 既知の制限: Twitter はレートリミットと期限切れトークン認証失敗の両方に HTTP 403 を返す。
 * このヘルパーは両者を区別できないため、ページネーション中に発生した
 * 403 認証失敗は 'rate_limit' として分類される。
 *
 * @param error エラーオブジェクト
 * @returns エラー種別
 */
function classifyError(
  error: unknown
): 'rate_limit' | 'api' | 'network' | 'unknown' {
  // TypeError はネットワーク接続失敗（DNS 解決失敗・接続拒否等）を示す
  if (error instanceof TypeError) return 'network'

  const status = (error as { response?: { status?: number } }).response?.status
  // 429/403 はレートリミット（withRetry がリトライ上限超過後にスロー）
  // 注意: 403 はトークン期限切れでも発生するが、応答ボディを解析しない限り判別不可
  if (status === 429 || status === 403) return 'rate_limit'
  // その他の HTTP エラー
  if (status !== undefined) return 'api'

  return 'unknown'
}

/** 1 ページ分のツイート処理結果 */
interface PageProcessResult {
  /** このページで新規追加・更新した件数 */
  addedThisPage: number
  /** 次のページで使用する globalPosition */
  nextGlobalPosition: number
  /** ページ内の analyzer 呼び出し thunk 一覧（後で並列数制限付きで実行する） */
  analyzeQueue: (() => Promise<void>)[]
}

/**
 * 1 ページ分のツイートを DB へ保存し、analyzer 呼び出し thunk を収集する。
 * プロモーション (広告) ツイートは除外する。
 *
 * @param tweets ページ内のツイート一覧
 * @param account アカウント設定
 * @param database Database インスタンス
 * @param crawledAt クロール日時
 * @param globalPosition ページ開始時点の globalPosition
 * @param crawledTweetIds クロールで取得済みの tweet_id 集合（このページの結果を追加する）
 * @returns このページの処理結果
 */
function processPageTweets(
  tweets: TweetApiUtilsData[],
  account: AccountConfig,
  database: Database.Database,
  crawledAt: string,
  globalPosition: number,
  crawledTweetIds: Set<string>
): PageProcessResult {
  let addedThisPage = 0
  const analyzeQueue: (() => Promise<void>)[] = []

  for (const tweetResult of tweets) {
    // プロモーション (広告) ツイートは除外
    if (tweetResult.promotedMetadata) {
      continue
    }
    const entry = extractBookmarkEntry(tweetResult)
    if (entry) {
      upsertTweetEntry(database, entry)
      upsertBookmark(
        database,
        entry.tweetId,
        account.username,
        crawledAt,
        globalPosition
      )
      crawledTweetIds.add(entry.tweetId)
      // 即座に起動せず thunk として退積し、後で並列数制限付きで実行する
      // 引用ツイート本文・カードタイトルも結合してタグ精度を高める
      const tweetId = entry.tweetId
      const analyzeText = [
        entry.fullText,
        entry.quotedTweet?.fullText,
        entry.cardInfo?.title,
      ]
        .filter(Boolean)
        .join('\n')
      analyzeQueue.push(() => analyzeAndSave(database, tweetId, analyzeText))
      globalPosition++
      addedThisPage++
    }
  }

  return { addedThisPage, nextGlobalPosition: globalPosition, analyzeQueue }
}

/** 1 アカウント分のページネーション取得結果 */
interface AccountCrawlResult {
  /** 今回のクロールで新規追加・更新した件数 */
  totalForAccount: number
  /** クロールで取得できた tweet_id の集合（差分削除に使用） */
  crawledTweetIds: Set<string>
  /** MAX_PAGES に達したため全件取得できなかったか */
  isReachedMaxPages: boolean
}

/**
 * 1 アカウント分のブックマークをページネーションしながら取得し、DB へ保存する。
 *
 * @param account アカウント設定
 * @param client Bookmarks API クライアント
 * @param database Database インスタンス
 * @returns 追加件数・取得済み tweet_id 集合・MAX_PAGES 到達フラグ
 */
async function crawlAccountBookmarks(
  account: AccountConfig,
  client: TwitterOpenApiClient,
  database: Database.Database
): Promise<AccountCrawlResult> {
  let cursor: string | undefined
  let page = 0
  // Twitter API は最新ブックマーク順で返すため、
  // globalPosition = 0 が最も新しいブックマークを表す
  let globalPosition = 0
  let totalForAccount = 0
  const crawledAt = new Date().toISOString()
  // クロールで取得した tweet_id の集合（差分削除に使用）
  const crawledTweetIds = new Set<string>()
  // MAX_PAGES に達した場合は差分削除を行わないためのフラグ
  let isReachedMaxPages = false

  while (true) {
    page++
    logger.info(
      `[${account.username}] Fetching page ${page}... (total so far: ${totalForAccount})`
    )

    const response = await withRetry(
      () =>
        client.getTweetApi().getBookmarks({
          count: BOOKMARKS_PER_PAGE,
          ...(cursor !== undefined && { cursor }),
        }),
      { operationName: `getBookmarks page ${page}`, maxRetries: 3 }
    )

    const tweets = response.data.data
    const { addedThisPage, nextGlobalPosition, analyzeQueue } =
      processPageTweets(
        tweets,
        account,
        database,
        crawledAt,
        globalPosition,
        crawledTweetIds
      )
    globalPosition = nextGlobalPosition

    // ページ内の全ツイートの分析を並列で待つ（同時実行数を ANALYZER_CONCURRENCY に制限）
    for (
      let index = 0;
      index < analyzeQueue.length;
      index += ANALYZER_CONCURRENCY
    ) {
      await Promise.all(
        analyzeQueue
          .slice(index, index + ANALYZER_CONCURRENCY)
          .map((function_) => function_())
      )
    }

    totalForAccount += addedThisPage
    logger.info(
      `[${account.username}] Page ${page} done. ${addedThisPage} added. Total: ${totalForAccount}`
    )

    // 次ページのカーソルを取得
    // プロモーション (広告) を除いた実ツイート数が 0 の場合は全件取得済みとみなす。
    // addedThisPage だけでなく processableTweetsCount で判定することで、
    // プロモーションのみのページで誤って早期終了するのを防ぐ。
    const processableTweetsCount = tweets.filter(
      (t) => !t.promotedMetadata
    ).length
    const nextCursor = response.data.cursor.bottom?.value
    if (!nextCursor || processableTweetsCount === 0) {
      logger.info(`[${account.username}] All bookmarks fetched.`)
      break
    }
    if (page >= MAX_PAGES) {
      logger.warn(
        `[${account.username}] Reached MAX_PAGES (${MAX_PAGES}). Stopping to prevent infinite loop.`
      )
      isReachedMaxPages = true
      break
    }
    cursor = nextCursor
  }

  return { totalForAccount, crawledTweetIds, isReachedMaxPages }
}

/**
 * 全アカウントのブックマークをクロールしてデータベースに保存する。
 * クロール完了後、Twitter 側で削除済みのブックマークを DB から自動削除する。
 * MAX_PAGES 到達・クロール結果が空で既存ブックマークがある場合は
 * 誤削除防止のため差分削除をスキップする。
 *
 * @param database Database インスタンス
 */
export async function runCrawl(database: Database.Database): Promise<void> {
  if (crawlState.isRunning) {
    logger.warn('Crawl is already running. Skipping.')
    return
  }

  crawlState.isRunning = true
  const jobId = createCrawlJob(database)
  logger.info(`Crawl job #${jobId} started.`)

  try {
    // クロール実行のたびに設定ファイルを再読み込みする。
    // これにより、config.json を編集してもサービス再起動なしに次回クロールへ反映される（ホットリロード）。
    const config = loadConfig()
    const accounts = config.twitter.accounts
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('No accounts found in config.json.')
    }

    updateCrawlJob(database, jobId, 'running', {
      accountsTotal: accounts.length,
    })
    let successCount = 0

    for (const account of accounts) {
      logger.info(`===== Account: ${account.username} =====`)

      // 認証エラーを個別に捕捉して error_type = 'auth' として記録する
      let authCookies: { authToken: string; ct0: string }
      try {
        authCookies = await getAuthCookies(account)
      } catch (error) {
        // エラーメッセージ先頭の "[username] " プレフィックスを除去して UI 表示用に簡潔にする
        const rawMessage =
          error instanceof Error ? error.message : String(error)
        const message = rawMessage.replace(
          new RegExp(String.raw`^\[${account.username}\]\s*`),
          ''
        )
        logger.error(
          `[${account.username}] Auth failed. Continuing to next account:`,
          error instanceof Error ? error : new Error(String(error))
        )
        saveCrawlAccountResult(
          database,
          jobId,
          account.username,
          'error',
          'auth',
          message,
          0
        )
        continue
      }

      const { authToken, ct0 } = authCookies
      // totalForAccount は catch ブロックからも参照するため外側で宣言する
      let totalForAccount = 0
      try {
        const client = await getBookmarksClient(
          authToken,
          ct0,
          config.twitter.clientLanguage
        )

        const crawlResult = await crawlAccountBookmarks(
          account,
          client,
          database
        )
        const { crawledTweetIds, isReachedMaxPages } = crawlResult
        totalForAccount = crawlResult.totalForAccount

        // MAX_PAGES に達した場合は全件取得できていないため差分削除を行わない
        if (isReachedMaxPages) {
          logger.warn(
            `[${account.username}] Skipping stale bookmark deletion because MAX_PAGES was reached.`
          )
        } else {
          // DB 上の tweet_id のうち今回のクロールで取得できなかったものを削除する
          const existingIds = getBookmarkTweetIds(database, account.username)
          if (crawledTweetIds.size === 0 && existingIds.length > 0) {
            // クロール結果が空かつ DB にブックマークが存在する場合は
            // Twitter API の一時的エラーによる誤削除を防ぐためスキップする
            logger.warn(
              `[${account.username}] Skipping stale bookmark deletion: no bookmarks fetched but ${existingIds.length} exist in DB.`
            )
          } else {
            const staleIds = existingIds.filter(
              (id) => !crawledTweetIds.has(id)
            )
            if (staleIds.length > 0) {
              logger.info(
                `[${account.username}] Deleting ${staleIds.length} stale bookmark(s) not found in crawl results.`
              )
              // 部分削除によるデータ不整合を防ぐためトランザクション内で一括削除する
              database.transaction(() => {
                for (const tweetId of staleIds) {
                  deleteBookmark(database, tweetId, account.username)
                }
              })()
            }
          }
        }

        successCount++
        saveCrawlAccountResult(
          database,
          jobId,
          account.username,
          'success',
          null,
          null,
          totalForAccount
        )
        // 成功のたびに accounts_succeeded を更新してポーリング UI に進捗を反映する
        updateCrawlJob(database, jobId, 'running', {
          accountsSucceeded: successCount,
        })
      } catch (error) {
        const errorType = classifyError(error)
        // エラーメッセージ先頭の "[username] " プレフィックスを除去して UI 表示用に簡潔にする
        const rawMessage =
          error instanceof Error ? error.message : String(error)
        const message = rawMessage.replace(
          new RegExp(String.raw`^\[${account.username}\]\s*`),
          ''
        )
        logger.error(
          `[${account.username}] Error occurred. Continuing to next account:`,
          error instanceof Error ? error : new Error(String(error))
        )
        saveCrawlAccountResult(
          database,
          jobId,
          account.username,
          'error',
          errorType,
          message,
          totalForAccount
        )
      }
    }

    updateCrawlJob(database, jobId, 'success', {
      finishedAt: new Date().toISOString(),
      accountsSucceeded: successCount,
    })
    logger.info(
      `Crawl job #${jobId} completed. ${successCount}/${accounts.length} accounts succeeded.`
    )

    // 全アカウントの分析完了後、IDF ベースのノイズタグを除去する（閾値 25%）
    await pruneNoiseTagsViaAnalyzer(0.25)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateCrawlJob(database, jobId, 'error', {
      finishedAt: new Date().toISOString(),
      errorMessage: message,
    })
    logger.error(
      `Crawl job #${jobId} failed:`,
      error instanceof Error ? error : new Error(String(error))
    )
  } finally {
    crawlState.isRunning = false
  }
}
