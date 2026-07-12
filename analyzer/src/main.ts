import path from 'node:path'
import { serve } from '@hono/node-server'
import { Logger } from '@book000/node-utils'
import { createServer } from './server'
import { openDatabase } from './infra/database'
import { initTokenizer } from './core/tagger'

const logger = Logger.configure('main')

const dataDirectory = process.env.DATA_DIR ?? '/data'
const port = Number(process.env.ANALYZER_PORT ?? '3002')
const databasePath = path.join(dataDirectory, 'db.sqlite')

logger.info(`Initializing database at ${databasePath}...`)
const database = openDatabase(databasePath)
;(async () => {
  logger.info('Initializing kuromoji tokenizer...')
  try {
    const tokenizer = await initTokenizer()
    logger.info('Tokenizer ready.')
    const app = createServer(database, tokenizer)
    logger.info(`Starting HTTP server on port ${port}...`)
    serve({ fetch: app.fetch, port })
  } catch (error) {
    logger.error(
      'Failed to initialize tokenizer:',
      error instanceof Error ? error : new Error(String(error))
    )
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1)
  }
})()
