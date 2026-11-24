import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getCrawlJobCompletionStatus, isRunning, runCrawl } from './crawler'
import { initDatabase } from '../infra/database'

const dataDir = process.env.DATA_DIR ?? ''
if (!dataDir.startsWith(os.tmpdir())) {
  throw new Error('DATA_DIR must be an isolated temporary directory')
}

void test('resets the running flag when crawl-job creation fails', async () => {
  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'twitter-bookmark-hub-crawler-')
  )
  const db = initDatabase(path.join(testDir, 'db.sqlite'))

  try {
    db.exec(`
      CREATE TRIGGER fail_crawl_job_insert
      BEFORE INSERT ON crawl_jobs
      BEGIN
        SELECT RAISE(ABORT, 'simulated crawl-job insert failure');
      END
    `)

    await runCrawl(db)

    assert.equal(isRunning(), false)
  } finally {
    db.close()
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})

void test('all failed accounts produce an error crawl job', () => {
  assert.equal(getCrawlJobCompletionStatus(0), 'error')
})

void test('at least one successful account produces a successful crawl job', () => {
  assert.equal(getCrawlJobCompletionStatus(1), 'success')
})

const tweetEntry = (id: string) =>
  ({
    tweet: {
      restId: id,
      legacy: { idStr: id, fullText: id, createdAt: '2024-01-01T00:00:00Z' },
    },
    user: { restId: 'user', core: { screenName: 'user', name: 'User' } },
  }) as unknown

/** `getBookmarks` が返すページ応答のうち、クロールが参照する部分のみのモデル。 */
interface PageResponse {
  data: unknown[]
  cursor: { bottom?: { value: string } }
}

/**
 * 与えた応答関数でクロールを 1 回実行し、要求 cursor 列・保存済み tweet_id・ジョブ状態を返す。
 * DB には今回のクロールで取得されない既存ブックマーク `older` を事前投入する。
 */
async function runPagination(respond: (cursor?: string) => PageResponse) {
  const { extractBookmarkEntry } = await import('../infra/bookmarks-api')
  const { getBookmarkTweetIds, upsertTweetEntry, upsertBookmark } =
    await import('../infra/database')
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-pages-'))
  const db = initDatabase(path.join(testDir, 'db.sqlite'))
  const old = extractBookmarkEntry(
    tweetEntry('older') as Parameters<typeof extractBookmarkEntry>[0]
  )
  assert.ok(old)
  upsertTweetEntry(db, old)
  upsertBookmark(db, old.tweetId, 'test', '2024-01-01', 0)
  const requests: (string | undefined)[] = []
  const dependencies: NonNullable<Parameters<typeof runCrawl>[1]> = {
    loadConfig: () => ({
      twitter: { accounts: [{ username: 'test', email: '', password: '' }] },
    }),
    getAuthCookies: () => Promise.resolve({ authToken: 'test', ct0: 'test' }),
    getBookmarksClient: () =>
      Promise.resolve({
        getTweetApi: () => ({
          getBookmarks: async ({ cursor }: { cursor?: string }) => {
            await Promise.resolve()
            requests.push(cursor)
            return { data: respond(cursor) }
          },
        }),
      } as unknown as Awaited<
        ReturnType<
          NonNullable<Parameters<typeof runCrawl>[1]>['getBookmarksClient']
        >
      >),
  }
  try {
    await runCrawl(db, dependencies)
    return {
      requests,
      tweetIds: getBookmarkTweetIds(db, 'test').toSorted((a, b) =>
        a.localeCompare(b)
      ),
      status: (
        db
          .prepare('SELECT status FROM crawl_jobs ORDER BY id DESC LIMIT 1')
          .get() as { status: string }
      ).status,
    }
  } finally {
    db.close()
    fs.rmSync(testDir, { recursive: true, force: true })
  }
}

void test('pagination preserves bookmarks after an ads-only page', async () => {
  const result = await runPagination((cursor) => {
    if (cursor === undefined)
      return {
        data: [tweetEntry('new')],
        cursor: { bottom: { value: 'page-2' } },
      }
    if (cursor === 'page-2')
      return {
        data: [{ promotedMetadata: {} }],
        cursor: { bottom: { value: 'page-3' } },
      }
    return { data: [tweetEntry('older')], cursor: {} }
  })
  assert.deepEqual(result.requests, [undefined, 'page-2', 'page-3'])
  assert.deepEqual(result.tweetIds, ['new', 'older'])
  assert.equal(result.status, 'success')
})

void test('an empty page echoing the requested cursor ends the crawl', async () => {
  const result = await runPagination((cursor) =>
    cursor === undefined
      ? { data: [tweetEntry('new')], cursor: { bottom: { value: 'page-2' } } }
      : { data: [], cursor: { bottom: { value: 'page-2' } } }
  )
  assert.deepEqual(result.requests, [undefined, 'page-2'])
  assert.equal(result.status, 'success')
  assert.deepEqual(result.tweetIds, ['new'])
})

void test('an ads-only page echoing the requested cursor ends the crawl', async () => {
  const result = await runPagination((cursor) =>
    cursor === undefined
      ? { data: [tweetEntry('new')], cursor: { bottom: { value: 'page-2' } } }
      : {
          data: [{ promotedMetadata: {} }],
          cursor: { bottom: { value: 'page-2' } },
        }
  )
  assert.deepEqual(result.requests, [undefined, 'page-2'])
  assert.equal(result.status, 'success')
  assert.deepEqual(result.tweetIds, ['new'])
})

void test('a page with bookmarks echoing the requested cursor fails the crawl', async () => {
  const result = await runPagination((cursor) => ({
    data: [tweetEntry(cursor === undefined ? 'new' : 'older')],
    cursor: { bottom: { value: 'page-2' } },
  }))
  assert.deepEqual(result.requests, [undefined, 'page-2'])
  assert.deepEqual(result.tweetIds, ['new', 'older'])
  assert.equal(result.status, 'error')
})

void test('a page whose entries all fail extraction and echoes the requested cursor fails the crawl', async () => {
  const unextractable = {
    tweet: { restId: 'broken', legacy: { idStr: 'broken', fullText: '' } },
    user: { restId: 'user' },
  }
  const result = await runPagination((cursor) => ({
    data: [cursor === undefined ? tweetEntry('new') : unextractable],
    cursor: { bottom: { value: 'page-2' } },
  }))
  assert.deepEqual(result.requests, [undefined, 'page-2'])
  assert.equal(result.status, 'error')
  assert.deepEqual(result.tweetIds, ['new', 'older'])
})
