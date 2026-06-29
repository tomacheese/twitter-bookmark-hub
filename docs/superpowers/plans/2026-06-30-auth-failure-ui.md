# Auth Failure UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store per-account crawl results (auth/API/network error type + message) in SQLite and surface failing accounts in the CrawlStatus header component.

**Architecture:** New `crawl_account_results` table holds per-account results per crawl job. Crawler writes results; viewer/backend reads them via an extended `getLatestCrawlJob()`. The shared `CrawlJobStatus` type grows an `accountResults` field, which the Vue `CrawlStatus.vue` uses to render a collapsible failed-account list.

**Tech Stack:** TypeScript · better-sqlite3 · Hono · Vue 3 Composition API · pnpm workspaces

## Global Constraints

- `skipLibCheck: true` must never be added to any tsconfig
- Prettier: no semicolons, single quotes, trailing commas es5, 2-space indent
- JSDoc comments in Japanese
- Half-width space between Japanese and alphanumeric characters in comments
- All SQL queries must use parameterized statements (no string concatenation)
- `pnpm lint` must pass in every package touched before each commit
- Git commit messages: Conventional Commits, Japanese description
- **Task 1 and Task 2 must be committed in sequence without pushing to CI in between.** After Task 1 alone, `viewer/backend`'s tsc will fail because `CrawlJobStatus.accountResults` is required but not yet returned. Task 2 fixes this. Only push to CI / open the PR after both commits are done.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `shared/src/schema.ts` | Modify | Add `crawl_account_results` DDL + index |
| `shared/src/types.ts` | Modify | Add `CrawlAccountResult`; extend `CrawlJobStatus` |
| `shared/src/index.ts` | Modify | Re-export `CrawlAccountResult` |
| `viewer/backend/src/infra/database.ts` | Modify | Extend `getLatestCrawlJob` to join account results |
| `crawler/src/infra/database.ts` | Modify | `saveCrawlAccountResult`, `getCrawlAccountResults`, extend `getLatestCrawlJob` |
| `crawler/src/core/crawler.ts` | Modify | `classifyError` helper; separate auth try/catch; save per-account results |
| `crawler/src/server.ts` | No change | `getLatestCrawlJob` already returns enriched object via Task 3 |
| `viewer/frontend/src/api.ts` | Modify | Re-export `CrawlAccountResult` |
| `viewer/frontend/src/components/CrawlStatus.vue` | Modify | Expand toggle + failed-account list UI |

---

### Task 1: Shared — Schema DDL + Types

> ⚠️ Do **not** push to CI after this commit alone — see Global Constraints. Proceed immediately to Task 2.

**Files:**
- Modify: `shared/src/schema.ts`
- Modify: `shared/src/types.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces:
  - `CrawlAccountResult` interface (exported from `@twitter-bookmark-hub/shared`)
  - `CrawlJobStatus.accountResults: CrawlAccountResult[]`
  - `crawl_account_results` SQL table (auto-created via `SCHEMA_DDL`)

---

- [ ] **Step 1: Add `crawl_account_results` table to SCHEMA_DDL**

In `shared/src/schema.ts`, insert after the `crawl_jobs` table block (before the existing `CREATE INDEX` statements):

```sql
  CREATE TABLE IF NOT EXISTS crawl_account_results (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    crawl_job_id      INTEGER NOT NULL REFERENCES crawl_jobs(id),
    username          TEXT    NOT NULL,
    status            TEXT    NOT NULL CHECK(status IN ('success', 'error')),
    error_type        TEXT    CHECK(error_type IN ('auth', 'rate_limit', 'api', 'network', 'unknown')),
    error_message     TEXT,
    bookmarks_crawled INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_crawl_account_results_job
    ON crawl_account_results(crawl_job_id);
```

- [ ] **Step 2: Add `CrawlAccountResult` interface to shared/src/types.ts**

Append after the `CrawlJobStatus` interface:

```typescript
/** アカウント別クロール結果 */
export interface CrawlAccountResult {
  /** アカウントのユーザー名 */
  username: string
  /** 結果ステータス */
  status: 'success' | 'error'
  /** エラー種別（成功時は null） */
  errorType:
    | 'auth'
    | 'rate_limit'
    | 'api'
    | 'network'
    | 'unknown'
    | null
  /** エラーメッセージ（成功時は null） */
  errorMessage: string | null
  /** クロールしたブックマーク数 */
  bookmarksCrawled: number
}
```

- [ ] **Step 3: Extend `CrawlJobStatus` in shared/src/types.ts**

Replace the existing `CrawlJobStatus` interface with:

```typescript
/** クロールジョブのステータス */
export interface CrawlJobStatus {
  /** ジョブ ID */
  id: number
  /** 開始日時 (ISO 8601) */
  startedAt: string
  /** 終了日時 (ISO 8601)。実行中は null */
  finishedAt: string | null
  /** ジョブステータス */
  status: 'running' | 'success' | 'error'
  /** エラーメッセージ（エラー時のみ） */
  errorMessage: string | null
  /** 対象アカウント総数 */
  accountsTotal: number | null
  /** 成功アカウント数 */
  accountsSucceeded: number | null
  /** アカウント別クロール結果一覧 */
  accountResults: CrawlAccountResult[]
}
```

- [ ] **Step 4: Re-export `CrawlAccountResult` from shared/src/index.ts**

Replace the existing type export list:

```typescript
export type {
  CardInfo,
  MediaItem,
  UrlEntity,
  QuotedTweet,
  BookmarkItem,
  BookmarksResponse,
  AccountInfo,
  CrawlJobStatus,
  CrawlAccountResult,
  TagItem,
  CategoryItem,
  AnalyzeResponse,
  FeaturesResponse,
} from './types'
```

- [ ] **Step 5: Type-check shared package**

```bash
cd shared && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit (do not push yet — proceed to Task 2 first)**

```bash
git add shared/src/schema.ts shared/src/types.ts shared/src/index.ts
git commit -m "feat(shared): crawl_account_results テーブルと CrawlAccountResult 型を追加する"
```

---

### Task 2: Viewer Backend — Extend `getLatestCrawlJob`

> Applies immediately after Task 1. Restores `viewer/backend` tsc compliance.

**Files:**
- Modify: `viewer/backend/src/infra/database.ts`

**Interfaces:**
- Consumes: `CrawlAccountResult` from `@twitter-bookmark-hub/shared`
- Produces: `getLatestCrawlJob(db): CrawlJobStatus | null` now includes `accountResults`

---

- [ ] **Step 1: Import `CrawlAccountResult` in viewer/backend/src/infra/database.ts**

Update the existing import from `@twitter-bookmark-hub/shared` (add `CrawlAccountResult`):

```typescript
import type {
  CardInfo,
  CrawlJobStatus,
  CrawlAccountResult,
  MediaItem,
  QuotedTweet,
  UrlEntity,
} from '@twitter-bookmark-hub/shared'
```

- [ ] **Step 2: Replace `getLatestCrawlJob` function (lines 579–615)**

```typescript
/**
 * 最新のクロールジョブをアカウント別結果と合わせて取得する
 * @param db - Database インスタンス
 * @returns 最新のクロールジョブ情報、存在しない場合は null
 */
export function getLatestCrawlJob(
  db: Database.Database
): CrawlJobStatus | null {
  const row = db
    .prepare(
      `SELECT id, started_at, finished_at, status, error_message,
              accounts_total, accounts_succeeded
       FROM crawl_jobs
       ORDER BY id DESC
       LIMIT 1`
    )
    .get() as
    | {
        id: number
        started_at: string
        finished_at: string | null
        status: 'running' | 'success' | 'error'
        error_message: string | null
        accounts_total: number | null
        accounts_succeeded: number | null
      }
    | undefined

  if (!row) return null

  // アカウント別クロール結果を取得する
  // 2 クエリ構成だが、10 秒ポーリングに対してクエリ間隔は無視できる
  const accountResultRows = db
    .prepare(
      `SELECT username, status, error_type, error_message, bookmarks_crawled
       FROM crawl_account_results
       WHERE crawl_job_id = ?
       ORDER BY id ASC`
    )
    .all(row.id) as {
    username: string
    status: 'success' | 'error'
    error_type:
      | 'auth'
      | 'rate_limit'
      | 'api'
      | 'network'
      | 'unknown'
      | null
    error_message: string | null
    bookmarks_crawled: number
  }[]

  const accountResults: CrawlAccountResult[] = accountResultRows.map((r) => ({
    username: r.username,
    status: r.status,
    errorType: r.error_type,
    errorMessage: r.error_message,
    bookmarksCrawled: r.bookmarks_crawled,
  }))

  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    errorMessage: row.error_message,
    accountsTotal: row.accounts_total,
    accountsSucceeded: row.accounts_succeeded,
    accountResults,
  }
}
```

- [ ] **Step 3: Verify lint passes for shared AND viewer/backend**

```bash
cd shared && pnpm lint
cd ../viewer/backend && pnpm lint
```

Expected: no errors in either package.

- [ ] **Step 4: Commit**

```bash
git add viewer/backend/src/infra/database.ts
git commit -m "feat(viewer/backend): getLatestCrawlJob にアカウント別結果を追加する"
```

---

### Task 3: Crawler — DB Helper Functions

**Files:**
- Modify: `crawler/src/infra/database.ts`

**Interfaces:**
- Consumes: `CrawlAccountResult` from `@twitter-bookmark-hub/shared`
- Produces:
  - `saveCrawlAccountResult(db, crawlJobId, username, status, errorType, errorMessage, bookmarksCrawled): void`
  - `getCrawlAccountResults(db, crawlJobId): CrawlAccountResult[]`
  - Updated `getLatestCrawlJob(db)` that includes `accountResults`

---

- [ ] **Step 1: Import `CrawlAccountResult` in crawler/src/infra/database.ts**

Replace the existing import from `@twitter-bookmark-hub/shared`:

```typescript
import {
  SCHEMA_DDL,
  applyColumnMigrations,
  type CrawlAccountResult,
} from '@twitter-bookmark-hub/shared'
```

- [ ] **Step 2: Add `saveCrawlAccountResult` function**

Append after `updateCrawlJob`:

```typescript
/**
 * アカウント別クロール結果を保存する。
 *
 * @param db Database インスタンス
 * @param crawlJobId クロールジョブ ID
 * @param username アカウントのユーザー名
 * @param status 結果ステータス
 * @param errorType エラー種別（成功時は null）
 * @param errorMessage エラーメッセージ（成功時は null）
 * @param bookmarksCrawled クロールしたブックマーク数
 */
export function saveCrawlAccountResult(
  db: Database.Database,
  crawlJobId: number,
  username: string,
  status: 'success' | 'error',
  errorType:
    | 'auth'
    | 'rate_limit'
    | 'api'
    | 'network'
    | 'unknown'
    | null,
  errorMessage: string | null,
  bookmarksCrawled: number
): void {
  db.prepare(
    `INSERT INTO crawl_account_results
      (crawl_job_id, username, status, error_type, error_message, bookmarks_crawled)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crawlJobId, username, status, errorType, errorMessage, bookmarksCrawled)
}
```

- [ ] **Step 3: Add `getCrawlAccountResults` function**

Append after `saveCrawlAccountResult`:

```typescript
/**
 * 指定クロールジョブのアカウント別結果一覧を返す。
 *
 * @param db Database インスタンス
 * @param crawlJobId クロールジョブ ID
 * @returns アカウント別クロール結果の配列
 */
export function getCrawlAccountResults(
  db: Database.Database,
  crawlJobId: number
): CrawlAccountResult[] {
  const rows = db
    .prepare(
      `SELECT username, status, error_type, error_message, bookmarks_crawled
       FROM crawl_account_results
       WHERE crawl_job_id = ?
       ORDER BY id ASC`
    )
    .all(crawlJobId) as {
    username: string
    status: 'success' | 'error'
    error_type:
      | 'auth'
      | 'rate_limit'
      | 'api'
      | 'network'
      | 'unknown'
      | null
    error_message: string | null
    bookmarks_crawled: number
  }[]

  return rows.map((row) => ({
    username: row.username,
    status: row.status,
    errorType: row.error_type,
    errorMessage: row.error_message,
    bookmarksCrawled: row.bookmarks_crawled,
  }))
}
```

- [ ] **Step 4: Extend `getLatestCrawlJob` in crawler/src/infra/database.ts**

Replace the existing `getLatestCrawlJob` function with:

```typescript
/**
 * 最新のクロールジョブをアカウント別結果と合わせて取得する。
 *
 * @param db Database インスタンス
 * @returns ジョブレコードまたは null
 */
export function getLatestCrawlJob(
  db: Database.Database
): (Record<string, unknown> & { accountResults: CrawlAccountResult[] }) | null {
  const row = db
    .prepare('SELECT * FROM crawl_jobs ORDER BY id DESC LIMIT 1')
    .get() as Record<string, unknown> | undefined
  if (!row) return null

  const accountResults = getCrawlAccountResults(db, row.id as number)
  return { ...row, accountResults }
}
```

- [ ] **Step 5: Verify lint passes**

```bash
cd crawler && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add crawler/src/infra/database.ts
git commit -m "feat(crawler): アカウント別クロール結果の保存・取得関数を追加する"
```

---

### Task 4: Crawler — Error Classification + Per-Account Result Saving

**Files:**
- Modify: `crawler/src/core/crawler.ts`

**Interfaces:**
- Consumes: `saveCrawlAccountResult(...)` from `../infra/database`
- Produces: per-account rows inserted into `crawl_account_results` after each account

---

- [ ] **Step 1: Import `saveCrawlAccountResult` in crawler.ts**

Update the existing database import block:

```typescript
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
```

- [ ] **Step 2: Add `classifyError` helper before `runCrawl`**

Insert immediately before `export async function runCrawl(...)`:

```typescript
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
```

- [ ] **Step 3: Replace the per-account for-loop in `runCrawl`**

Locate the block starting at `for (const account of accounts) {` (line 163) and ending at the closing `}` of the outer for-loop (line 311). Replace it entirely with:

```typescript
    for (const account of accounts) {
      logger.info(`===== Account: ${account.username} =====`)

      // 認証エラーを個別に捕捉して error_type = 'auth' として記録する
      let authCookies: { authToken: string; ct0: string }
      try {
        authCookies = await getAuthCookies(account)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(
          `[${account.username}] Auth failed. Continuing to next account:`,
          error instanceof Error ? error : new Error(String(error))
        )
        saveCrawlAccountResult(
          db,
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

        let cursor: string | undefined
        let page = 0
        // Twitter API は最新ブックマーク順で返すため、
        // globalPosition = 0 が最も新しいブックマークを表す
        let globalPosition = 0
        const crawledAt = new Date().toISOString()
        // クロールで取得した tweet_id の集合（差分削除に使用）
        const crawledTweetIds = new Set<string>()
        // MAX_PAGES に達した場合は差分削除を行わないためのフラグ
        let reachedMaxPages = false

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
          // ANALYZER_URL が設定されている場合は analyze 対象を収集する（thunk にして後から制限付き並列実行）
          const analyzeQueue: (() => Promise<void>)[] = []

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
              analyzeQueue.push(() => analyzeAndSave(db, tweetId, analyzeText))
              globalPosition++
              addedThisPage++
            }
          }

          // ページ内の全ツイートの分析を並列で待つ（同時実行数を ANALYZER_CONCURRENCY に制限）
          for (
            let i = 0;
            i < analyzeQueue.length;
            i += ANALYZER_CONCURRENCY
          ) {
            await Promise.all(
              analyzeQueue.slice(i, i + ANALYZER_CONCURRENCY).map((fn) => fn())
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
            reachedMaxPages = true
            break
          }
          cursor = nextCursor
        }

        // MAX_PAGES に達した場合は全件取得できていないため差分削除を行わない
        if (reachedMaxPages) {
          logger.warn(
            `[${account.username}] Skipping stale bookmark deletion because MAX_PAGES was reached.`
          )
        } else {
          // DB 上の tweet_id のうち今回のクロールで取得できなかったものを削除する
          const existingIds = getBookmarkTweetIds(db, account.username)
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
              db.transaction(() => {
                for (const tweetId of staleIds) {
                  deleteBookmark(db, tweetId, account.username)
                }
              })()
            }
          }
        }

        successCount++
        saveCrawlAccountResult(
          db,
          jobId,
          account.username,
          'success',
          null,
          null,
          totalForAccount
        )
      } catch (error) {
        const errorType = classifyError(error)
        const message = error instanceof Error ? error.message : String(error)
        logger.error(
          `[${account.username}] Error occurred. Continuing to next account:`,
          error instanceof Error ? error : new Error(String(error))
        )
        saveCrawlAccountResult(
          db,
          jobId,
          account.username,
          'error',
          errorType,
          message,
          totalForAccount
        )
      }
    }
```

- [ ] **Step 4: Verify lint passes**

```bash
cd crawler && pnpm lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add crawler/src/core/crawler.ts
git commit -m "feat(crawler): エラー種別を分類しアカウント別クロール結果を保存する"
```

---

### Task 5: Viewer Frontend — API Export + CrawlStatus UI

**Files:**
- Modify: `viewer/frontend/src/api.ts`
- Modify: `viewer/frontend/src/components/CrawlStatus.vue`

**Interfaces:**
- Consumes: `CrawlAccountResult` from `@twitter-bookmark-hub/shared`
- Consumes: `status.value.accountResults: CrawlAccountResult[]` (populated since Task 2)

---

- [ ] **Step 1: Re-export `CrawlAccountResult` from viewer/frontend/src/api.ts**

Replace the export block:

```typescript
export type {
  CardInfo,
  MediaItem,
  UrlEntity,
  QuotedTweet,
  BookmarkItem,
  BookmarksResponse,
  AccountInfo,
  CrawlJobStatus,
  CrawlAccountResult,
  FeaturesResponse,
  CategoryItem,
  TagItem,
} from '@twitter-bookmark-hub/shared'
```

- [ ] **Step 2: Replace the `<script setup>` block in CrawlStatus.vue**

Replace the entire existing `<script setup lang="ts">` block (lines 1–21) with:

```html
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCrawlStatus } from '../composables/useCrawlStatus'
import type { CrawlAccountResult } from '../api'

const { status, triggering, triggerCrawl } = useCrawlStatus()

/** 詳細パネルの開閉状態 */
const showDetails = ref(false)

// クロールジョブが切り替わったら詳細パネルを自動で閉じる
watch(
  () => status.value?.id,
  () => {
    showDetails.value = false
  }
)

/** 失敗したアカウント結果の一覧 */
const failedAccounts = computed<CrawlAccountResult[]>(
  () => status.value?.accountResults.filter((r) => r.status === 'error') ?? []
)

/** エラー種別の表示ラベル */
const ERROR_TYPE_LABELS: Record<string, string> = {
  auth: '🔒 認証エラー',
  rate_limit: '⏱ レート制限',
  api: '⚠ API エラー',
  network: '🌐 ネットワークエラー',
  unknown: '❓ 不明なエラー',
}

/**
 * エラー種別を日本語ラベルに変換する
 * @param errorType - エラー種別
 * @returns 表示用ラベル
 */
function errorTypeLabel(
  errorType: CrawlAccountResult['errorType']
): string {
  if (!errorType) return ''
  return ERROR_TYPE_LABELS[errorType] ?? '❓ 不明なエラー'
}

/**
 * 日時文字列を相対時刻に変換する
 * @param dateString - ISO 8601 形式の日時文字列
 * @returns 相対時刻の文字列
 */
function relativeTime(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diff = Math.floor((now - then) / 1000)

  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`
  if (diff < 86_400) return `${Math.floor(diff / 3600)} 時間前`
  return `${Math.floor(diff / 86_400)} 日前`
}
</script>
```

- [ ] **Step 3: Replace the `<template>` block in CrawlStatus.vue**

Replace the entire existing `<template>` block with:

```html
<template>
  <div class="crawl-status">
    <div v-if="status" class="status-info">
      <span
        class="status-dot"
        :class="{
          running: status.status === 'running',
          success: status.status === 'success',
          error: status.status === 'error',
        }"></span>
      <span v-if="status.status === 'running'" class="status-text">
        クロール中...
        <template v-if="status.accountsTotal != null">
          ({{ status.accountsSucceeded ?? 0 }}/{{ status.accountsTotal }})
        </template>
      </span>
      <span v-else-if="status.status === 'success'" class="status-text">
        最終クロール:
        {{ status.finishedAt ? relativeTime(status.finishedAt) : '-' }}
        <template
          v-if="
            status.accountsTotal != null &&
            status.accountsSucceeded != null &&
            status.accountsSucceeded < status.accountsTotal
          ">
          ({{ status.accountsSucceeded }}/{{ status.accountsTotal }})
        </template>
      </span>
      <span
        v-else-if="status.status === 'error'"
        class="status-text error-text">
        エラー
      </span>

      <!-- 失敗アカウントが存在するとき詳細トグルを表示する -->
      <button
        v-if="failedAccounts.length > 0"
        class="details-toggle"
        :aria-expanded="showDetails"
        aria-label="失敗アカウントの詳細を表示"
        @click="showDetails = !showDetails">
        {{ showDetails ? '▲' : '▼' }}
      </button>
    </div>

    <button
      class="crawl-button"
      :disabled="triggering || status?.status === 'running'"
      aria-label="クロール実行"
      @click="triggerCrawl">
      <svg viewBox="0 0 24 24" class="crawl-icon" aria-hidden="true">
        <path
          d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
          fill="currentColor" />
      </svg>
      <span class="crawl-btn-label">クロール実行</span>
    </button>

    <!-- 失敗アカウント詳細パネル（ドロップダウン） -->
    <div
      v-if="showDetails && failedAccounts.length > 0"
      class="account-errors"
      role="list"
      aria-label="認証・クロール失敗アカウント一覧">
      <div
        v-for="result in failedAccounts"
        :key="result.username"
        class="account-error-item"
        role="listitem">
        <div class="account-error-header">
          <span class="account-username">@{{ result.username }}</span>
          <span class="account-error-type">{{
            errorTypeLabel(result.errorType)
          }}</span>
        </div>
        <p v-if="result.errorMessage" class="account-error-message">
          {{ result.errorMessage }}
        </p>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Replace the `<style scoped>` block in CrawlStatus.vue**

Replace the entire existing `<style scoped>` block with:

```html
<style scoped>
.crawl-status {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
}

.crawl-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: none;
}

@media (max-width: 768px) {
  .crawl-icon {
    display: block;
  }

  .crawl-btn-label {
    display: none;
  }

  .crawl-button {
    padding: 7px 10px;
  }
}

.status-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  flex-shrink: 0;
}

.status-dot.running {
  background: var(--color-accent);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-dot.success {
  background: var(--color-success);
}

.status-dot.error {
  background: var(--color-error);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.status-text {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.error-text {
  color: var(--color-error);
}

.details-toggle {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
}

.details-toggle:hover {
  color: var(--color-text-primary);
}

.crawl-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 9999px;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}

.crawl-button:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.crawl-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 失敗アカウント詳細パネル */
.account-errors {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 100;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 8px 0;
  min-width: 280px;
  max-width: 400px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.account-error-item {
  padding: 8px 16px;
}

.account-error-item + .account-error-item {
  border-top: 1px solid var(--color-border);
}

.account-error-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.account-username {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.account-error-type {
  color: var(--color-error);
  font-size: 12px;
  white-space: nowrap;
}

.account-error-message {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
  /* 長いエラーメッセージを 3 行以内に収める */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
```

- [ ] **Step 5: Verify lint passes**

```bash
cd viewer/frontend && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add viewer/frontend/src/api.ts viewer/frontend/src/components/CrawlStatus.vue
git commit -m "feat(viewer/frontend): 失敗アカウント詳細パネルを CrawlStatus に追加する"
```

---

## Self-Review Checklist

- [x] **Spec coverage**
  - `crawl_account_results` DDL → Task 1 Step 1
  - `CrawlAccountResult` + `CrawlJobStatus.accountResults` → Task 1 Steps 2–3
  - viewer/backend `getLatestCrawlJob` join → Task 2 Step 2
  - `saveCrawlAccountResult` / `getCrawlAccountResults` → Task 3 Steps 2–3
  - `classifyError` helper → Task 4 Step 2
  - Separate auth try/catch → Task 4 Step 3
  - Frontend expand toggle + error list → Task 5 Steps 2–4
  - Error type labels (auth/rate_limit/api/network/unknown) → Task 5 Step 2

- [x] **Placeholder scan** — no TBD, TODO, or "fill in" phrases; full for-loop in Task 4 Step 3

- [x] **Type consistency**
  - `errorType` field name consistent across Tasks 1–5
  - `bookmarksCrawled` (camelCase) ↔ `bookmarks_crawled` (snake_case) mapping consistent in every task
  - `saveCrawlAccountResult` parameter order identical in Tasks 3 and 4

- [x] **Migration safety** — `CREATE TABLE IF NOT EXISTS` ensures existing databases auto-migrate without data loss

- [x] **CI break window** — Task 1 + Task 2 are ordered consecutively; Global Constraints note prohibits pushing to CI between them
