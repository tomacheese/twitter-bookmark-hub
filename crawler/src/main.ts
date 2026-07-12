import dns from 'node:dns'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { DATA_DIR } from './shared/config'
import { initDatabase } from './infra/database'
import { cleanupCycleTLS } from './infra/cycletls'
import { Logger } from '@book000/node-utils'
import { createServer } from './server'
import { startScheduler } from './scheduler'

// IPv6 環境で Twitter へのログインが DenyLoginSubtask で拒否される問題を回避するため、
// DNS 解決順序を IPv4 優先に設定する
dns.setDefaultResultOrder('ipv4first')

const logger = Logger.configure('main')

const port = Number(process.env.CRAWLER_PORT ?? '3001')
const databasePath = path.join(DATA_DIR, 'db.sqlite')

logger.info(`Initializing database at ${databasePath}...`)
const database = initDatabase(databasePath)

const app = createServer(database)
logger.info(`Starting HTTP server on port ${port}...`)
serve({ fetch: app.fetch, port })

startScheduler(database)

// プロセス終了時のクリーンアップ
// process.on() のリスナーは void を期待するため、async にはせず内部を IIFE にする
const shutdown = () => {
  logger.info('Shutting down...')
  ;(async () => {
    let exitCode = 0
    try {
      await cleanupCycleTLS()
    } catch (error) {
      console.error('Shutdown error:', error)
      exitCode = 1
    } finally {
      database.close()
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(exitCode)
    }
  })()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
