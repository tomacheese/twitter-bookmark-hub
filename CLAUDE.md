# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**Twitter Bookmark Hub** — 複数の Twitter/X アカウントのブックマークを自動収集し、Twitter 風 Web UI で一元的に閲覧するアプリケーション。

| サービス | ポート | 説明 |
|---------|--------|------|
| `crawler` | 3001 | 全アカウントのブックマークを定期取得し SQLite に保存する HTTP API サービス |
| `viewer/backend` | 3000 | 収集済みブックマークを提供する API サーバー。フロントエンドの静的ファイルも配信 |
| `viewer/frontend` | - | Vue 3 + Vite で構築した Twitter 風 Web UI（本番ビルドは backend に同梱） |
| `shared` | - | crawler・backend 間の共有型定義・SQLite スキーマ DDL |

## リポジトリ構成

```
crawler/
  src/
    core/
      crawler.ts        # メインクロールロジック (runCrawl, isRunning)
    infra/
      auth.ts           # Cookie 管理・Twitter 認証
      bookmarks-api.ts  # Twitter API クライアント・データ抽出
      database.ts       # SQLite 初期化・データ永続化
      cycletls.ts       # TLS フィンガープリント偽装 (CycleTLS ラッパー)
    shared/
      config.ts         # 設定ファイルロード (DATA_DIR, loadConfig)
      retry.ts          # リトライロジック (withRetry, rate limit 対応)
      types.ts          # crawler 内部型定義 (AccountConfig, BookmarkEntry 等)
    main.ts             # エントリポイント (DB 初期化・サーバー起動・スケジューラ)
    scheduler.ts        # cron スケジューラ (node-cron)
    server.ts           # HTTP API サーバー (Hono, /health /crawl /crawl/status)
  Dockerfile            # 2 ステージビルド (builder + runner)

shared/
  src/
    schema.ts           # SQLite DDL 定数 (SCHEMA_DDL: CREATE TABLE 文)
    types.ts            # 共有型 (BookmarkItem, MediaItem, UrlEntity 等)
    index.ts            # エクスポート

viewer/
  backend/
    src/
      infra/
        database.ts     # DB 操作 (getBookmarks, getAccounts, getLatestCrawlJob)
      routes/
        accounts.ts     # GET /api/accounts
        bookmarks.ts    # GET /api/bookmarks (ページネーション・検索・フィルタ)
        crawl.ts        # GET /api/crawl/status, POST /api/crawl/trigger
      shared/
        types.ts        # shared パッケージからの型の再エクスポート
      main.ts           # エントリポイント
      server.ts         # Hono サーバー設定 (SPA フォールバック・静的配信)
    Dockerfile          # 3 ステージビルド (frontend builder + backend builder + runner)
  frontend/
    src/
      components/
        AccountFilter.vue   # アカウント絞り込みサイドバー
        BookmarkCard.vue    # ツイートカード (テキスト・メディア・引用ツイート等)
        BookmarkList.vue    # ブックマーク一覧 + ページネーション
        CrawlStatus.vue     # ヘッダー内クロール状態表示・手動実行ボタン
      composables/
        useAccounts.ts      # アカウント一覧の状態管理
        useBookmarks.ts     # ブックマーク取得・ページネーション・ソート
        useCrawlStatus.ts   # クロール状態ポーリング (10 秒間隔)
      api.ts            # バックエンド API クライアント
      App.vue           # ルートコンポーネント (レイアウト・ルーティング)
      main.ts           # Vue アプリ初期化
    vite.config.ts      # Vite 設定 (/api/* → http://localhost:3000 にプロキシ)

compose.yaml            # Docker Compose 定義
```

## 技術スタック

| 領域 | 技術 |
|------|------|
| 言語 | TypeScript |
| ランタイム | Node.js v24 |
| パッケージマネージャー | pnpm (workspace モノレポ) |
| crawler / backend フレームワーク | Hono |
| DB | better-sqlite3 (SQLite、WAL モード) |
| frontend フレームワーク | Vue 3 Composition API + Vite |
| Twitter API | twitter-openapi-typescript, @the-convocation/twitter-scraper |
| TLS フィンガープリント偽装 | cycletls (Chrome 120 偽装) |
| Lint | ESLint (`@book000/eslint-config`) + Prettier |
| タイムゾーン | Asia/Tokyo (Docker コンテナ全体) |

## 開発コマンド

### 依存パッケージのインストール

```bash
# リポジトリルートで一度実行する (pnpm workspace により全パッケージに適用される)
pnpm install
```

### Lint / フォーマット

```bash
# 各パッケージディレクトリで実行する (crawler / viewer/backend / viewer/frontend)
pnpm lint       # ESLint + Prettier チェック + TypeScript 型チェック
pnpm fix        # 自動修正 (ESLint --fix + Prettier --write)
```

CI (`nodejs-ci.yml`) は `crawler`、`viewer/backend`、`viewer/frontend` の 3 ディレクトリで `pnpm lint` を実行する。**PR 前に必ず全パッケージで lint をパスさせること。**

### 起動

```bash
# Docker Compose で全サービス起動（推奨）
docker compose up -d

# 個別起動（開発時）
cd crawler && pnpm start          # ポート 3001
cd viewer/backend && pnpm start   # ポート 3000 (Docker Compose では外部公開)
cd viewer/frontend && pnpm dev    # Vite 開発サーバー (API は localhost:3000 にプロキシ)
cd viewer/frontend && pnpm build  # プロダクションビルド (dist/ に出力)
```

## アーキテクチャ / データフロー

```
config.json (アカウント設定)
      ↓
  crawler (port 3001)
  ├── scheduler.ts  ← cron (CRAWL_SCHEDULE)
  ├── server.ts     ← GET /health, POST /crawl, GET /crawl/status
  └── core/crawler.ts
      ├── infra/auth.ts        ← Cookie 取得 (env → ファイルキャッシュ → ライブログイン)
      ├── infra/bookmarks-api.ts ← twitter-openapi-typescript + CycleTLS
      └── infra/database.ts    → data/db.sqlite (WAL モード)
                                         ↓
                              viewer/backend (port 3000)
                              ├── GET /api/accounts
                              ├── GET /api/bookmarks (ページネーション・検索・フィルタ)
                              ├── GET /api/crawl/status
                              ├── POST /api/crawl/trigger → crawler /crawl
                              └── static /public (Vue 3 SPA)
                                         ↓
                              viewer/frontend (Vue 3)
                              ├── useBookmarks.ts  ← GET /api/bookmarks
                              ├── useAccounts.ts   ← GET /api/accounts
                              └── useCrawlStatus.ts ← GET /api/crawl/status (10 秒ポーリング)
```

## DB スキーマ

SQLite。6 テーブル構成。DDL は `shared/src/schema.ts` の `SCHEMA_DDL` 定数に定義されている。WAL モード・外部キー制約・ビジータイムアウト 5 秒で初期化される。

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `users` | `user_id` (TEXT) | Twitter ユーザー情報 |
| `tweets` | `tweet_id` (TEXT) | ツイート本文・カード情報・引用ツイート参照 |
| `media_items` | `id` (INTEGER) | 写真・動画・GIF (tweet_id FK) |
| `url_entities` | `id` (INTEGER) | t.co URL → 展開 URL マッピング |
| `bookmarks` | `(tweet_id, account_username)` | どのアカウントがいつブックマークしたか |
| `crawl_jobs` | `id` (INTEGER) | クロール実行履歴・ステータス |

### bookmarks テーブルの重要フィールド

- `first_bookmarked_at` — 最初に検出した日時
- `last_seen_at` — 最後に検出した日時（ソートキーに使用）
- `position` — Twitter API レスポンス内の順位（0 = 最新）

## crawler の主要モジュール詳細

### infra/auth.ts — 認証・Cookie 管理

Cookie の取得順序 (優先度順):
1. 環境変数 `TWITTER_AUTH_TOKEN_{USERNAME}` / `TWITTER_CT0_{USERNAME}`
2. `$DATA_DIR/cookies-{username}.json` のキャッシュ (有効期限 7 日)
3. twitter-scraper + CycleTLS によるライブログイン

ログインリトライ戦略 (失敗時にローテーション):
1. メールアドレス + xpff OFF
2. メールアドレス + xpff ON
3. ユーザー名 + xpff ON

エラー別待機:
- HTTP 503: 指数バックオフ (最大 30 秒)
- HTTP 399 (不審なアクティビティ): 120 秒待機
- DenyLoginSubtask: 3-5 秒待機、次の戦略に切替

### infra/cycletls.ts — TLS フィンガープリント偽装

Chrome 120 on Windows 10 の JA3 TLS フィンガープリントを使用。`cycleTLSFetch` は fetch API 互換のラッパーとして機能し、twitter-openapi-typescript に渡す。

### infra/bookmarks-api.ts — Twitter API データ抽出

`extractBookmarkEntry()` が以下を抽出:
- ツイート: ID・ユーザー情報・本文・投稿日時
- メディア: 写真・動画 (最高ビットレート MP4)・GIF
- URL: t.co → 展開 URL マッピング
- カード: YouTube (player)・OGP サマリー (summary / summary_large_image)
- 引用ツイート: ネスト構造

プロモーションツイートは除外する。

### shared/retry.ts — リトライロジック

`withRetry<T>()` は以下を処理:
- 通常エラー: 指数バックオフ (最大 3 回、最大 30 秒)
- レート制限 (429/403): `x-rate-limit-reset` ヘッダーまで待機、最大 10 回

## viewer/backend の API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/accounts` | アカウント一覧 (ブックマーク数付き) |
| GET | `/api/bookmarks` | ブックマーク一覧 (下記クエリパラメータ参照) |
| GET | `/api/crawl/status` | 最新クロールジョブの状態 |
| POST | `/api/crawl/trigger` | クロールを手動実行 (crawler の /crawl を呼び出し) |

### GET /api/bookmarks のクエリパラメータ

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `page` | `1` | ページ番号 |
| `limit` | `20` | 1 ページあたり件数 (最大 100) |
| `q` | - | 全文検索クエリ |
| `account` | - | アカウント名でフィルタ |
| `sort` | `desc` | 昇順 / 降順 (`asc` / `desc`) |
| `sort_by` | `bookmarked_at` | ソートキー (`bookmarked_at` / `created_at`) |

`sort_by=created_at` は Snowflake ID の数値比較で実装されている。

## crawler の API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/health` | ヘルスチェック (`{status: 'ok', timestamp}`) |
| POST | `/crawl` | クロールを手動実行 (409 = 実行中、202 = 開始) |
| GET | `/crawl/status` | 最新クロールジョブの状態 |

## viewer/frontend の状態管理

| composable | 管理する状態 |
|-----------|-------------|
| `useBookmarks` | ブックマーク一覧・ページネーション・検索・ソート設定 (ソート設定は localStorage 永続化) |
| `useAccounts` | アカウント一覧 |
| `useCrawlStatus` | クロール状態 (10 秒ポーリング)・手動実行 |

ソート設定のキー: `bookmark-sort-by`, `bookmark-sort-order`

`useBookmarks` は `watchEffect` の cancel フラグで並行フェッチの競合状態を防止している。

## 環境変数

### crawler

| 変数名 | Dockerfile デフォルト | 説明 |
|--------|----------------------|------|
| `DATA_DIR` | `/data` | データディレクトリ (config.json・DB・Cookie の保存先) |
| `LOG_DIR` | `/data/logs` | ログディレクトリ |
| `CRAWLER_PORT` | `3001` | HTTP サーバーポート |
| `CRAWL_SCHEDULE` | `0 * * * *` | クロールスケジュール (cron 式) |
| `CRAWL_ON_STARTUP` | `true` | 起動時に即クロール実行。`false` 文字列で無効化 |
| `PROXY_SERVER` | - | プロキシサーバー URL |
| `PROXY_USERNAME` | - | プロキシ認証ユーザー名 |
| `PROXY_PASSWORD` | - | プロキシ認証パスワード |
| `TWITTER_AUTH_TOKEN_{USERNAME}` | - | アカウント個別の auth_token Cookie (ログイン省略) |
| `TWITTER_CT0_{USERNAME}` | - | アカウント個別の ct0 Cookie (ログイン省略) |

### viewer/backend

| 変数名 | Dockerfile デフォルト | 説明 |
|--------|----------------------|------|
| `DATA_DIR` | `/data` | SQLite DB (`db.sqlite`) の保存先 |
| `LOG_DIR` | `/data/logs` | ログディレクトリ |
| `VIEWER_PORT` | `3000` | HTTP サーバーポート |
| `CRAWLER_URL` | `http://crawler:3001` | crawler サービスの URL |

## Docker ビルド

### crawler — 2 ステージビルド

1. **builder** (`node:24-alpine`): better-sqlite3 のネイティブモジュールをコンパイル。`pnpm deploy` でスタンドアロンパッケージを生成
2. **runner** (`node:24-alpine`): tzdata・ライブラリのみインストール。`tsx src/main.ts` で起動

### viewer — 3 ステージビルド

1. **frontend-builder**: Vite でフロントエンドをビルドし `dist/` を出力
2. **backend-builder**: バックエンドの依存をインストールし、`dist/` を `public/` にコピー
3. **runner**: バックエンドを起動。`public/` の静的ファイルも配信し、SPA フォールバックで `index.html` を返す

両コンテナともタイムゾーンは `Asia/Tokyo` に設定されている。

## コーディング規約

- **JSDoc**: 関数・インターフェースには日本語で JSDoc を記載する。
- **コメント**: コード内コメントは日本語で記載する。エラーメッセージは英語。
- **日本語と英数字の間**には半角スペースを挿入する。
- **`skipLibCheck`** を `true` にすることは絶対に禁止。
- **フォーマット**: Prettier の設定に従う。
- **Lint**: `@book000/eslint-config` の設定に従う。
- **SQL インジェクション対策**: パラメータ化クエリを使用する。ソート・オーダーはホワイトリスト方式で検証する (`viewer/backend/src/infra/database.ts` 参照)。
- **README.md の更新**: 仕様変更・環境変数の追加・変更時は `README.md` を更新する。

## セキュリティ / 機密情報

以下のファイルは絶対にコミットしない:

- `data/config.json` — Twitter 認証情報 (パスワード・OTP シークレット)
- `data/cookies-{username}.json` — Cookie キャッシュ (7 日間有効)
- `.env` — 環境変数 (`.env.example` のみコミット可)
- `data/db.sqlite` — ブックマーク DB

## Git 運用

- コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う。`<description>` は日本語で記載する。
- ブランチ名は [Conventional Branch](https://conventional-branch.github.io) に従う。
- `data/`、`.env`、Cookie ファイルなど機密情報を含むファイルはコミットしない。
- **git push は SSH を使用する** (HTTPS は使用しない)。

## CI

GitHub Actions の `nodejs-ci.yml` が PR・push 時に以下を実行する:

- `crawler`、`viewer/backend`、`viewer/frontend` それぞれで `pnpm lint`

ローカルで `pnpm lint` がパスしない場合は `pnpm fix` で自動修正後、再度確認すること。
