import type Database from 'better-sqlite3'
import cron from 'node-cron'
import { runCrawl } from './core/crawler.js'
import { Logger } from '@book000/node-utils'

const logger = Logger.configure('scheduler')

/**
 * 定期クロールスケジューラを起動する。
 * 環境変数 CRAWL_SCHEDULE で cron 式を設定可能 (デフォルト: 毎時 0 分)。
 * CRAWL_ON_STARTUP が 'false' でなければ起動直後にもクロールを実行する。
 *
 * @param db Database インスタンス
 */
export function startScheduler(db: Database.Database): void {
  const schedule = process.env.CRAWL_SCHEDULE ?? '0 * * * *'

  logger.info(`Scheduling crawl with cron: ${schedule}`)
  cron.schedule(schedule, () => {
    logger.info('Scheduled crawl triggered.')
    runCrawl(db).catch((error: unknown) => {
      logger.error(
        'Scheduled crawl failed unexpectedly:',
        error instanceof Error ? error : new Error(String(error))
      )
    })
  })

  // 起動時に即クロール実行 (デフォルト有効)
  if (process.env.CRAWL_ON_STARTUP !== 'false') {
    logger.info('Running initial crawl on startup...')
    runCrawl(db).catch((error: unknown) => {
      logger.error(
        'Initial crawl failed unexpectedly:',
        error instanceof Error ? error : new Error(String(error))
      )
    })
  }
}
