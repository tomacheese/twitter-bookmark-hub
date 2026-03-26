import path from 'node:path'
import { serve } from '@hono/node-server'
import { openDatabase } from './infra/database'
import { createServer } from './server'
import { Logger } from '@book000/node-utils'

const logger = Logger.configure('main')

const DATA_DIR = process.env.DATA_DIR ?? '/data'
const PORT = Number(process.env.VIEWER_PORT ?? '3000')

const dbPath = path.join(DATA_DIR, 'db.sqlite')
logger.info(`Opening database: ${dbPath}`)

const db = openDatabase(dbPath)
const app = createServer(db)

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info(`Server listening on port ${PORT}`)
})
