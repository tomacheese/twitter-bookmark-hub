import dns from 'node:dns'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { DATA_DIR } from './shared/config.js'
import { initDatabase } from './infra/database.js'
import { cleanupCycleTLS } from './infra/cycletls.js'
import { Logger } from './infra/logger.js'
import { createServer } from './server.js'
import { startScheduler } from './scheduler.js'

// IPv6 環境で Twitter へのログインが DenyLoginSubtask で拒否される問題を回避するため、
// DNS 解決順序を IPv4 優先に設定する
dns.setDefaultResultOrder('ipv4first')

const logger = Logger.configure('main')

const port = Number(process.env.CRAWLER_PORT ?? '3001')
const dbPath = path.join(DATA_DIR, 'db.sqlite')

logger.log(`Initializing database at ${dbPath}...`)
const db = initDatabase(dbPath)

const app = createServer(db)
logger.log(`Starting HTTP server on port ${port}...`)
serve({ fetch: app.fetch, port })

startScheduler(db)

// プロセス終了時のクリーンアップ
const shutdown = () => {
  logger.log('Shutting down...')
  let exitCode = 0
  cleanupCycleTLS()
    .catch((error: unknown) => {
      console.error('Shutdown error:', error)
      exitCode = 1
    })
    .finally(() => {
      db.close()
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(exitCode)
    })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
