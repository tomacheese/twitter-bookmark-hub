import type Database from 'better-sqlite3'
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
  upsertTweetTags,
  upsertTweetCategories,
} from '../infra/database'
import { Logger } from '@book000/node-utils'

const logger = Logger.configure('crawler')

/**
 * analyzer に分析を依頼し、結果をデータベースに保存する。
 * ANALYZER_URL が設定されていない場合は何もしない。
 * 分析の失敗はログに記録するが、クロール全体は続行する。
 *
 * @param db Database インスタンス
 * @param tweetId ツイート ID
 * @param text 分析対象テキスト
 */
async function analyzeAndSave(
  db: Database.Database,
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
      upsertTweetTags(db, tweetId, result.tags)
    }
    if (Array.isArray(result.categories)) {
      upsertTweetCategories(db, tweetId, result.categories)
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

/** 1 回のクロールで取得するページ数の上限（API 異常時の無限ループ防止） */
const MAX_PAGES = 500

/** クロール実行中フラグ */
let running = false

/**
 * クロールが実行中かどうかを返す。
 * @returns 実行中なら true
 */
export function isRunning(): boolean {
  return running
}

/**
 * 全アカウントのブックマークをクロールしてデータベースに保存する。
 *
 * @param db Database インスタンス
 */
export async function runCrawl(db: Database.Database): Promise<void> {
  if (running) {
    logger.warn('Crawl is already running. Skipping.')
    return
  }

  running = true
  const jobId = createCrawlJob(db)
  logger.info(`Crawl job #${jobId} started.`)

  try {
    // クロール実行のたびに設定ファイルを再読み込みする。
    // これにより、config.json を編集してもサービス再起動なしに次回クロールへ反映される（ホットリロード）。
    const config = loadConfig()
    const accounts = config.twitter.accounts
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('No accounts found in config.json.')
    }

    updateCrawlJob(db, jobId, 'running', { accountsTotal: accounts.length })
    let successCount = 0

    for (const account of accounts) {
      logger.info(`===== Account: ${account.username} =====`)
      try {
        const { authToken, ct0 } = await getAuthCookies(account)
        const client = await getBookmarksClient(authToken, ct0)

        let cursor: string | undefined
        let page = 0
        let totalForAccount = 0
        // Twitter API は最新ブックマーク順で返すため、
        // globalPosition = 0 が最も新しいブックマークを表す
        let globalPosition = 0
        const crawledAt = new Date().toISOString()

        while (true) {
          page++
          logger.info(
            `[${account.username}] Fetching page ${page}... (total so far: ${totalForAccount})`
          )

          const response = await withRetry(
            () =>
              client.getTweetApi().getBookmarks({
                count: BOOKMARKS_PER_PAGE,
                ...(cursor === undefined ? {} : { cursor }),
              }),
            { operationName: `getBookmarks page ${page}`, maxRetries: 3 }
          )

          const tweets = response.data.data
          let addedThisPage = 0
          // ページ内の analyzer 呼び出しをまとめて並列実行する
          const analyzePromises: Promise<void>[] = []

          for (const tweetResult of tweets) {
            // プロモーション (広告) ツイートは除外
            if (tweetResult.promotedMetadata) {
              continue
            }
            const entry = extractBookmarkEntry(tweetResult)
            if (entry) {
              upsertTweetEntry(db, entry)
              upsertBookmark(
                db,
                entry.tweetId,
                account.username,
                crawledAt,
                globalPosition
              )
              // ANALYZER_URL が設定されている場合は analyzer に分析を依頼する（並列）
              analyzePromises.push(
                analyzeAndSave(db, entry.tweetId, entry.fullText)
              )
              globalPosition++
              addedThisPage++
            }
          }

          // ページ内の全ツイートの分析を並列で待つ
          await Promise.all(analyzePromises)

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
            break
          }
          cursor = nextCursor
        }

        successCount++
      } catch (error) {
        logger.error(
          `[${account.username}] Error occurred. Continuing to next account:`,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }

    updateCrawlJob(db, jobId, 'success', {
      finishedAt: new Date().toISOString(),
      accountsSucceeded: successCount,
    })
    logger.info(
      `Crawl job #${jobId} completed. ${successCount}/${accounts.length} accounts succeeded.`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateCrawlJob(db, jobId, 'error', {
      finishedAt: new Date().toISOString(),
      errorMessage: message,
    })
    logger.error(
      `Crawl job #${jobId} failed:`,
      error instanceof Error ? error : new Error(String(error))
    )
  } finally {
    running = false
  }
}
