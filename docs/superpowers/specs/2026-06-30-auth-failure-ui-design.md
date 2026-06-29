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

> **Known limitation — 403 during pagination:** Twitter returns HTTP 403 for both rate-limit and mid-crawl auth failures (expired token). `withRetry` treats both the same way: it retries up to 10 times then re-throws. As a result, an expired-token 403 that fires *after* `getAuthCookies()` succeeds will be classified as `rate_limit`, not `auth`. Addressing this accurately would require inspecting response body content — out of scope for this feature. Operators seeing `rate_limit` on a persistent basis should treat it as a potential auth issue as well.

### `bookmarksCrawled` field semantics

For **success** rows: number of bookmarks successfully saved in that crawl run.
For **error** rows: number of bookmarks saved *before* the failure. A partial failure (e.g. pagination error on page 3) will have a value > 0. A pure auth failure (never reached the crawl loop) will have 0.

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

`CrawlJobStatus` gains one new required field:

```typescript
accountResults: CrawlAccountResult[];
```

> **⚠️ Compilation-breaking change:** Adding a required field to `CrawlJobStatus` will cause a TypeScript compile error in any file that constructs a `CrawlJobStatus` object without `accountResults`. In this codebase, `viewer/backend/src/infra/database.ts` (`getLatestCrawlJob()`) is the only such file. It **must be updated in the same commit sequence** as `shared/src/types.ts` — do not push to CI after the shared-types change alone. See the implementation plan's Global Constraints for the exact ordering.

---

## Crawler Changes (`crawler/`)

### `infra/database.ts`

Two new functions:

- `saveCrawlAccountResult(db, crawlJobId, username, status, errorType, errorMessage, bookmarksCrawled)` — inserts one row into `crawl_account_results`
- `getCrawlAccountResults(db, crawlJobId)` — returns all rows for a given job

### `core/crawler.ts`

- `classifyError(error: unknown): 'rate_limit' | 'api' | 'network' | 'unknown'` helper (excludes `auth` — auth failures are caught separately before this function is called)
- `getAuthCookies()` is wrapped in its own try/catch; on failure, writes `error_type = 'auth'` and `continue`s to the next account
- On crawl success, calls `saveCrawlAccountResult()` with `status: 'success'` and final `bookmarksCrawled` count
- On crawl error, calls `saveCrawlAccountResult()` with classified error type and partial `bookmarksCrawled` count

### `server.ts` — `GET /crawl/status`

No route-level change needed; `getLatestCrawlJob()` in `crawler/src/infra/database.ts` is extended to append `accountResults` to the returned object, which `c.json()` serialises automatically.

---

## Viewer Backend Changes (`viewer/backend/`)

### `infra/database.ts`

`getLatestCrawlJob()` extended with a second SELECT on `crawl_account_results` (filtered by the latest job's ID) and returns `accountResults: CrawlAccountResult[]` (empty array when no rows exist — including the never-run state where `getLatestCrawlJob()` returns `null` entirely, which is unchanged behaviour).

### `routes/crawl.ts` — `GET /api/crawl/status`

No route-level changes needed; the richer object returned by `getLatestCrawlJob()` is serialised as-is.

---

## Frontend Changes (`viewer/frontend/`)

### `api.ts`

Re-exports `CrawlAccountResult` from `@twitter-bookmark-hub/shared` so Vue components can use it as a TypeScript type annotation (e.g. `computed<CrawlAccountResult[]>(...)`). The actual data is accessed via `CrawlJobStatus.accountResults` which is already included in the existing `fetchCrawlStatus()` return type.

### `components/CrawlStatus.vue`

**When to show the expand toggle:**
- `status.accountResults` contains at least one entry with `status === 'error'`

The toggle is **not** shown when `accountsSucceeded < accountsTotal` without a corresponding error entry; that condition alone does not reliably indicate actionable failures (the count difference can also reflect in-progress accounts during a running crawl).

**Partial results during a running crawl:** `saveCrawlAccountResult()` is called per account as it completes, so `accountResults` is partially populated during a running crawl. If account A fails and accounts B/C are still in progress, A's error entry will appear in the expanded panel while the header still shows "クロール中... (1/3)". This is intentional — early failure visibility is useful — and no special handling is required.

**Interaction:**
- An expand toggle (`▼` / `▲`) appears immediately after the status text
- Clicking it reveals a dropdown panel anchored to the top-right of the `.crawl-status` container
- Default state: collapsed
- Auto-collapses when a new crawl job starts (i.e. when `status.id` changes)

**Success state count display (new):** When `status === 'success'` and `accountsSucceeded < accountsTotal`, the header now shows the partial count `(2/3)` next to the relative timestamp. This is a new rendering addition for the success state; it was not shown before.

**Error type labels (Japanese):**

| `errorType` | Label |
|---|---|
| `auth` | 🔒 認証エラー |
| `rate_limit` | ⏱ レート制限 |
| `api` | ⚠ API エラー |
| `network` | 🌐 ネットワークエラー |
| `unknown` | ❓ 不明なエラー |
| `null` (success row) | — (success rows are never shown in the panel) |

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
- Disambiguation of mid-crawl 403 auth failures from true rate-limit 403s (see Known Limitation above)

---

## File Change Summary

| File | Change |
|---|---|
| `shared/src/schema.ts` | Add `crawl_account_results` table + index |
| `shared/src/types.ts` | Add `CrawlAccountResult`; extend `CrawlJobStatus` with required `accountResults` |
| `shared/src/index.ts` | Re-export `CrawlAccountResult` |
| `viewer/backend/src/infra/database.ts` | `getLatestCrawlJob` runs second SELECT for account results |
| `crawler/src/infra/database.ts` | `saveCrawlAccountResult`, `getCrawlAccountResults`; extend `getLatestCrawlJob` |
| `crawler/src/core/crawler.ts` | `classifyError` helper; separate auth try/catch; save per-account results |
| `crawler/src/server.ts` | No change — `getLatestCrawlJob` already returns enriched object |
| `viewer/backend/src/routes/crawl.ts` | No change — passes through richer job object as-is |
| `viewer/frontend/src/api.ts` | Re-export `CrawlAccountResult` for type annotations |
| `viewer/frontend/src/components/CrawlStatus.vue` | Expand toggle + failed account list + success-state count display |
