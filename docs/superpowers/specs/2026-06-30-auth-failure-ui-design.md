# Auth Failure UI Design

**Date:** 2026-06-30
**Issue:** [#236](https://github.com/tomacheese/twitter-bookmark-hub/issues/236)
**Status:** Approved

## Problem

When the crawler fails to authenticate for an account, the only place to diagnose this is the server logs. There is no UI surface for operators to quickly see which accounts are failing and why.

## Goal

Expose per-account crawl results (success/failure, error type, error message) in the existing CrawlStatus header component so operators can identify failing accounts without inspecting logs.

---

## Data Layer

### New table: `crawl_account_results`

Added to `shared/src/schema.ts` via `SCHEMA_DDL` (uses `CREATE TABLE IF NOT EXISTS` — existing databases auto-migrate on next startup):

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

### Error type classification

| `error_type` | Trigger condition |
|---|---|
| `auth` | `getAuthCookies()` throws |
| `rate_limit` | `withRetry` exhausts retries on HTTP 429/403 |
| `api` | Bookmark fetch returns non-2xx after retries |
| `network` | `fetch` throws `TypeError` (connection refused / DNS failure) |
| `unknown` | Anything else |

Classification happens at the point the per-account `catch` block runs in `crawler/src/core/crawler.ts`. The function `classifyError(error: unknown): ErrorType` is extracted as a standalone helper for testability.

---

## Shared Types (`shared/src/types.ts`)

```typescript
/** アカウント別クロール結果 */
export interface CrawlAccountResult {
  username: string;
  status: 'success' | 'error';
  errorType: 'auth' | 'rate_limit' | 'api' | 'network' | 'unknown' | null;
  errorMessage: string | null;
  bookmarksCrawled: number;
}
```

`CrawlJobStatus` gains one new field:

```typescript
accountResults: CrawlAccountResult[];
```

---

## Crawler Changes (`crawler/`)

### `infra/database.ts`

Two new functions:

- `saveCrawlAccountResult(db, result)` — inserts one row into `crawl_account_results`
- `getCrawlAccountResults(db, crawlJobId)` — returns all rows for a given job (used by viewer/backend and crawler status endpoint)

### `core/crawler.ts`

- `classifyError(error: unknown): 'auth' | 'rate_limit' | 'api' | 'network' | 'unknown'` helper
- Per-account `catch` block now calls `saveCrawlAccountResult()` with classified error
- On success, also calls `saveCrawlAccountResult()` with `status: 'success'` and `bookmarksCrawled` count

### `server.ts` — `GET /crawl/status`

Extends the response to join `crawl_account_results` for the latest job.

---

## Viewer Backend Changes (`viewer/backend/`)

### `infra/database.ts`

`getLatestCrawlJob()` extended to LEFT JOIN `crawl_account_results` and return `accountResults: CrawlAccountResult[]` (empty array when no rows exist).

### `routes/crawl.ts` — `GET /api/crawl/status`

No route-level changes needed; the richer object returned by `getLatestCrawlJob()` is serialised as-is.

---

## Frontend Changes (`viewer/frontend/`)

### `api.ts`

Re-exports `CrawlAccountResult` from `@twitter-bookmark-hub/shared`. No logic change needed.

### `components/CrawlStatus.vue`

**When to show the detail panel:**
- `status.accountResults` contains at least one entry with `status === 'error'`
- OR `status.accountsSucceeded < status.accountsTotal`

**Interaction:**
- An expand toggle appears next to the status dot label
- Clicking it reveals an inline list below the header bar
- Default state: collapsed

**Error type labels (Japanese):**

| `errorType` | Label |
|---|---|
| `auth` | 🔒 認証エラー |
| `rate_limit` | ⏱ レート制限 |
| `api` | ⚠ API エラー |
| `network` | 🌐 ネットワークエラー |
| `unknown` | ❓ 不明なエラー |
| `null` (success row) | — |

**Collapsed state (header only):**
```
● 最終クロール: 3分前  (2/3)  ▼
```

**Expanded state:**
```
● 最終クロール: 3分前  (2/3)  ▲
┌─────────────────────────────────────────────┐
│ @example_user   🔒 認証エラー                │
│ Failed to obtain cookies after all strategies│
└─────────────────────────────────────────────┘
```

Successful accounts are **not** listed (noise reduction). Only failed accounts are shown.

---

## Out of Scope

- Historical crawl job list (only the latest job is surfaced)
- Sorting / filtering of account results in the UI
- Automatic retry trigger per account from the UI

---

## File Change Summary

| File | Change |
|---|---|
| `shared/src/schema.ts` | Add `crawl_account_results` table + index |
| `shared/src/types.ts` | Add `CrawlAccountResult`; extend `CrawlJobStatus` |
| `crawler/src/infra/database.ts` | `saveCrawlAccountResult`, `getCrawlAccountResults` |
| `crawler/src/core/crawler.ts` | `classifyError` helper; save result per account |
| `crawler/src/server.ts` | Join account results in `/crawl/status` response |
| `viewer/backend/src/infra/database.ts` | `getLatestCrawlJob` joins account results |
| `viewer/backend/src/routes/crawl.ts` | (minor) pass through richer job object |
| `viewer/frontend/src/api.ts` | Re-export `CrawlAccountResult` |
| `viewer/frontend/src/components/CrawlStatus.vue` | Expand toggle + failed account list |
