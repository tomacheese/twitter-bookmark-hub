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

void test('pagination preserves bookmarks after an ads-only page and rejects cursor cycles', async () => {
  const { extractBookmarkEntry } = await import('../infra/bookmarks-api')
  const { getBookmarkTweetIds, upsertTweetEntry, upsertBookmark } =
    await import('../infra/database')
  type Tweet = Parameters<typeof extractBookmarkEntry>[0]
  const tweet = (id: string) =>
    ({
      tweet: {
        restId: id,
        legacy: { idStr: id, fullText: id, createdAt: '2024-01-01T00:00:00Z' },
      },
      user: { restId: 'user', core: { screenName: 'user', name: 'User' } },
    }) as Tweet
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-pages-'))
  const db = initDatabase(path.join(testDir, 'db.sqlite'))
  const old = extractBookmarkEntry(tweet('older'))
  assert.ok(old)
  upsertTweetEntry(db, old)
  upsertBookmark(db, old.tweetId, 'test', '2024-01-01', 0)
  const requests: (string | undefined)[] = []
  let cycle = false
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
            if (cursor === undefined)
              return {
                data: {
                  data: [tweet('new')],
                  cursor: { bottom: { value: 'page-2' } },
                },
              }
            if (cursor === 'page-2')
              return {
                data: {
                  data: [{ promotedMetadata: {} }],
                  cursor: { bottom: { value: cycle ? 'page-2' : 'page-3' } },
                },
              }
            return { data: { data: [tweet('older')], cursor: {} } }
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
    assert.deepEqual(requests, [undefined, 'page-2', 'page-3'])
    assert.deepEqual(
      getBookmarkTweetIds(db, 'test').toSorted((a, b) => a.localeCompare(b)),
      ['new', 'older']
    )
    assert.equal(
      (
        db
          .prepare('SELECT status FROM crawl_jobs ORDER BY id DESC LIMIT 1')
          .get() as { status: string }
      ).status,
      'success'
    )
    cycle = true
    requests.length = 0
    await runCrawl(db, dependencies)
    assert.deepEqual(requests, [undefined, 'page-2'])
    assert.deepEqual(
      getBookmarkTweetIds(db, 'test').toSorted((a, b) => a.localeCompare(b)),
      ['new', 'older']
    )
    assert.equal(
      (
        db
          .prepare('SELECT status FROM crawl_jobs ORDER BY id DESC LIMIT 1')
          .get() as { status: string }
      ).status,
      'error'
    )
  } finally {
    db.close()
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})
