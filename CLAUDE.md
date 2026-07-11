# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**Twitter Bookmark Hub** — 複数の Twitter/X アカウントのブックマークを自動収集し、Twitter 風 Web UI で一元的に閲覧するアプリケーション。

| サービス | ポート | 説明 |
|---------|--------|------|
| `crawler` | 3001 | 全アカウントのブックマークを定期取得し SQLite に保存する HTTP API サービス |
| `viewer/backend` | 3000 | 収集済みブックマークを提供する API サーバー。フロントエンドの静的ファイルも配信 |
| `viewer/frontend` | - | Vue 3 + Vite で構築した Twitter 風 Web UI（本番ビルドは backend に同梱） |
| `analyzer` | 3002 | （任意）収集済みツイートを kuromoji で形態素解析し、タグ抽出・カテゴリ自動分類を行う HTTP API サービス。Docker Compose の `analyzer` プロファイルでのみ起動する |
| `shared` | - | crawler・backend・analyzer 間の共有型定義・SQLite スキーマ DDL |

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
    types.ts            # 共有型 (BookmarkItem, MediaItem, UrlEntity, FeaturesResponse 等)
    index.ts            # エクスポート

analyzer/                 # (任意) 形態素解析によるタグ抽出・カテゴリ分類サービス
  src/
    core/
      tagger.ts         # kuromoji トークナイザ初期化・名詞抽出 (initTokenizer, extractNouns)
      categorizer.ts    # タグとカテゴリキーワードの照合 (matchCategories)
    infra/
      database.ts       # DB 操作 (タグ・カテゴリの保存/取得、IDF ノイズプルーニング)
    routes/
      analyze.ts        # POST /analyze, POST /analyze/prune-noise
      categories.ts     # GET/POST /categories, PUT/DELETE /categories/:id
      tags.ts           # GET /tags
    main.ts             # エントリポイント (DB 初期化・kuromoji 初期化・サーバー起動)
    server.ts           # Hono サーバー設定 (/health + 各ルート)
  Dockerfile            # analyzer コンテナ (kuromoji 辞書同梱)

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
        CategoryFilter.vue  # (analyzer 有効時) カテゴリ絞り込み
        CategoryManager.vue # (analyzer 有効時) カテゴリの作成・編集・削除 UI
        SearchOptions.vue   # 検索対象グループ (text/card/url/author/quoted) の選択
      composables/
        useAccounts.ts      # アカウント一覧の状態管理
        useBookmarks.ts     # ブックマーク取得・ページネーション・ソート
        useCrawlStatus.ts   # クロール状態ポーリング (10 秒間隔)
        useCategories.ts    # (analyzer 有効時) カテゴリ一覧・管理
        useFeatures.ts      # 機能フラグ取得 (GET /api/features、analyzer 有効判定)
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
| crawler / backend / analyzer フレームワーク | Hono |
| DB | better-sqlite3 (SQLite、WAL モード) |
| frontend フレームワーク | Vue 3 Composition API + Vite |
| 形態素解析 (analyzer) | @patdx/kuromoji (日本語)、stopword (英語ストップワード) |
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
# 各パッケージディレクトリで実行する (crawler / viewer/backend / viewer/frontend / analyzer)
pnpm lint       # ESLint + Prettier チェック + TypeScript 型チェック
pnpm fix        # 自動修正 (ESLint --fix + Prettier --write)
```

CI (`nodejs-ci.yml`) は `crawler`、`viewer/backend`、`viewer/frontend`、`analyzer` の 4 ディレクトリで `pnpm lint` を実行する。**PR 前に必ず全パッケージで lint をパスさせること。**

### 起動

```bash
# Docker Compose で全サービス起動（推奨）
docker compose up -d

# analyzer（任意機能）も起動する場合は analyzer プロファイルを有効にする
#   .env に ANALYZER_URL=http://analyzer:3002 を設定してから:
docker compose --profile analyzer up -d

# 個別起動（開発時）
cd crawler && pnpm start          # ポート 3001
cd viewer/backend && pnpm start   # ポート 3000 (Docker Compose では外部公開)
cd viewer/frontend && pnpm dev    # Vite 開発サーバー (API は localhost:3000 にプロキシ)
cd viewer/frontend && pnpm build  # プロダクションビルド (dist/ に出力)
cd analyzer && pnpm start         # ポート 3002 (任意機能)
```

### テスト環境の構築

**目的別に使い分ける**:

| 目的 | 手段 | 所要時間 |
|------|------|---------|
| フロントエンドの変更確認 | `pnpm dev`（HMR） | 数秒 |
| viewer/backend または crawler の変更確認 | `tsx` 直接起動 | 数秒 |
| コンテナ環境の再現テスト（alpine/glibc 差異の確認等） | Docker（末尾参照） | 初回 20 分以上 |

**基本方針**: Docker は使わず `tsx` 直接起動を使う。`better-sqlite3` のネイティブモジュールは `pnpm install` でホスト OS 向けにコンパイル済みのため、ローカル起動に問題はない。

#### パターン A: フロントエンドのみ変更（pnpm dev）

```bash
pnpm --filter twitter-bookmark-hub-frontend dev
# http://localhost:5173 でアクセス（API は localhost:3000 の常用 backend にプロキシ）
```

HMR で即反映。常用 backend が起動中であれば追加作業不要。

#### パターン B: viewer/backend を変更する場合

viewer/backend の `serveStatic` は **cwd 相対**（`./public`）のため、`viewer/backend/` ディレクトリで起動する必要がある。初回のみ `public/` のシンボリックリンクを作成する。

```bash
# 初回のみ: frontend の dist を backend の静的配信ルートにリンク
pnpm --filter twitter-bookmark-hub-frontend build
ln -sf "$(pwd)/viewer/frontend/dist" "$(pwd)/viewer/backend/public"
```

```bash
# viewer/backend を起動（ポート 3000 は常用と被る場合は変更する）
cd viewer/backend
DATA_DIR=$(pwd)/../../data \
  VIEWER_PORT=3000 \
  CRAWLER_URL=http://localhost:3001 \
  LOG_DIR=$(pwd)/../../logs \
  ./node_modules/.bin/tsx src/main.ts
# http://localhost:3000 でアクセス
```

frontend の変更も同時に確認したい場合は `pnpm dev`（ポート 5173）を別ターミナルで起動する。

#### パターン C: crawler も変更する場合

```bash
# リポジトリルートで実行
DATA_DIR=$(pwd)/data \
  CRAWL_ON_STARTUP=false \
  CRAWL_SCHEDULE="0 0 31 2 *" \
  CRAWLER_PORT=3001 \
  LOG_DIR=$(pwd)/logs \
  ./crawler/node_modules/.bin/tsx crawler/src/main.ts
```

`CRAWL_SCHEDULE="0 0 31 2 *"` で cron クロールを無効化する（`CRAWL_ON_STARTUP=false` だけでは起動時クロールしか止まらない）。

#### 注意点

- `DATA_DIR` は絶対パスで指定する（cwd が変わると相対パスがずれる）
- `viewer/backend/public` のシンボリックリンクを作成済みの場合、frontend のビルドを更新しても自動で反映される（シンボリックリンクが dist を指しているため）
- ポート 3000 を常用環境が使用中の場合は `VIEWER_PORT=3020` 等に変更する

#### Docker による本番再現テスト（必要な場合のみ）

コンテナ環境（alpine）との差異確認が必要な場合のみ使用する。**リポジトリルートで実行すること**。

```bash
# ビルド
docker build -t tbh-test-crawler:dev -f crawler/Dockerfile .
docker build -t tbh-test-viewer:dev  -f viewer/Dockerfile .

# 起動（同名コンテナが残っていれば先に docker rm する）
docker run -d --name tbh-test-crawler \
  -v "$(pwd)/data:/data" -p 3021:3001 \
  -e CRAWL_ON_STARTUP=false -e CRAWL_SCHEDULE="0 0 31 2 *" \
  tbh-test-crawler:dev

docker run -d --name tbh-test-viewer \
  -v "$(pwd)/data:/data" -p 3020:3000 \
  -e CRAWLER_URL=http://host.docker.internal:3021 \
  --add-host=host.docker.internal:host-gateway \
  tbh-test-viewer:dev

# クリーンアップ
docker stop tbh-test-viewer tbh-test-crawler
docker rm   tbh-test-viewer tbh-test-crawler
docker rmi  tbh-test-viewer:dev tbh-test-crawler:dev
```

## アーキテクチャ / データフロー

```
config.json (アカウント設定)
      ↓
  crawler (port 3001)
  ├── scheduler.ts  ← cron (CRAWL_SCHEDULE)
  ├── server.ts     ← GET /health, POST/GET /crawl(/status), POST/DELETE /bookmarks
  └── core/crawler.ts
      ├── infra/auth.ts        ← Cookie 取得 (env → ファイルキャッシュ → ライブログイン)
      ├── infra/bookmarks-api.ts ← twitter-openapi-typescript + CycleTLS
      ├── infra/database.ts    → data/db.sqlite (WAL モード)
      └── (ANALYZER_URL 設定時) → analyzer /analyze・/analyze/prune-noise を呼び出し
                                         ↓
                              viewer/backend (port 3000)
                              ├── GET /api/accounts
                              ├── GET /api/bookmarks (ページネーション・検索・フィルタ)
                              ├── GET /api/crawl/status
                              ├── POST /api/crawl/trigger → crawler /crawl
                              ├── GET /api/features (analyzer 有効判定)
                              ├── /api/categories, /api/tags → analyzer へプロキシ (ANALYZER_URL 設定時)
                              └── static /public (Vue 3 SPA)
                                         ↓
                              viewer/frontend (Vue 3)
                              ├── useBookmarks.ts  ← GET /api/bookmarks
                              ├── useAccounts.ts   ← GET /api/accounts
                              ├── useCrawlStatus.ts ← GET /api/crawl/status (10 秒ポーリング)
                              ├── useFeatures.ts   ← GET /api/features
                              └── useCategories.ts ← GET/POST/PUT/DELETE /api/categories (analyzer 有効時)

  analyzer (port 3002、任意 / ANALYZER_URL 設定時のみ)
  ├── core/tagger.ts     ← kuromoji 形態素解析でツイート本文から名詞タグを抽出
  ├── core/categorizer.ts ← タグとカテゴリキーワードを照合しカテゴリを付与
  └── infra/database.ts  → 同一 data/db.sqlite の tags/tweet_tags/categories/tweet_categories
```

## DB スキーマ

SQLite。11 テーブル構成（うち `tags` / `tweet_tags` / `categories` / `tweet_categories` の 4 テーブルは analyzer 機能用で、analyzer 未使用時は空のまま）。DDL は `shared/src/schema.ts` の `SCHEMA_DDL` 定数に定義されている。WAL モード・外部キー制約・ビジータイムアウト 5 秒で初期化される。viewer/backend は analyzer 用テーブルの存在を実行時にチェックし、無い場合はタグ・カテゴリ関連のクエリを省略する。

| テーブル | 主キー | 説明 |
|---------|--------|------|
| `users` | `user_id` (TEXT) | Twitter ユーザー情報 |
| `tweets` | `tweet_id` (TEXT) | ツイート本文・カード情報・引用ツイート参照 |
| `media_items` | `id` (INTEGER) | 写真・動画・GIF (tweet_id FK) |
| `url_entities` | `id` (INTEGER) | t.co URL → 展開 URL マッピング |
| `bookmarks` | `(tweet_id, account_username)` | どのアカウントがいつブックマークしたか |
| `crawl_jobs` | `id` (INTEGER) | クロール実行履歴・ステータス |
| `crawl_account_results` | `id` (INTEGER) | クロールジョブ内のアカウント別結果 (成功/失敗・エラー種別・取得件数) |
| `tags` | `id` (INTEGER) | (analyzer) 抽出されたタグ名 (UNIQUE) |
| `tweet_tags` | `(tweet_id, tag_id)` | (analyzer) ツイートとタグの関連 |
| `categories` | `id` (INTEGER) | (analyzer) カテゴリ定義 (name・color・keywords JSON) |
| `tweet_categories` | `(tweet_id, category_id)` | (analyzer) ツイートとカテゴリの関連 (confidence 付き) |

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
| GET | `/api/features` | 有効な機能フラグを返す (`{analyzer: boolean}`。`ANALYZER_URL` の有無で判定) |
| ALL | `/api/categories`, `/api/categories/:id`, `/api/tags` | analyzer へのプロキシ。`ANALYZER_URL` 未設定時は 404 を返す (10 秒タイムアウト) |

### GET /api/bookmarks のクエリパラメータ

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `page` | `1` | ページ番号 |
| `limit` | `20` | 1 ページあたり件数 (最大 100) |
| `q` | - | 全文検索クエリ |
| `search_in` | 全グループ | 検索対象グループをカンマ区切りで指定 (`text` / `card` / `url` / `author` / `quoted`) |
| `account` | - | アカウント名でフィルタ |
| `category` | - | カテゴリ ID でフィルタ (analyzer 有効時のみ有効) |
| `tag` | - | タグ名でフィルタ (analyzer 有効時のみ有効) |
| `sort` | `desc` | 昇順 / 降順 (`asc` / `desc`) |
| `sort_by` | `bookmarked_at` | ソートキー (`bookmarked_at` / `created_at`) |

`sort_by=created_at` は Snowflake ID の数値比較で実装されている。`category` / `tag` フィルタは対応するテーブルが存在しない場合 (analyzer 未使用時) は無視される。

## crawler の API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/health` | ヘルスチェック (`{status: 'ok', timestamp}`) |
| POST | `/crawl` | クロールを手動実行 (409 = 実行中、202 = 開始) |
| GET | `/crawl/status` | 最新クロールジョブの状態 |
| POST | `/bookmarks` | ブックマークを追加 (ボディ: `{account, tweetId}`)。Twitter API 経由でツイートを取得し DB に保存 |
| DELETE | `/bookmarks/:tweetId` | ブックマークを削除 (クエリ: `?account=<username>`)。DB からも即時削除 |

## analyzer（任意機能）

`ANALYZER_URL` が設定され、Docker Compose の `analyzer` プロファイルで起動した場合のみ動作する。kuromoji による日本語形態素解析でツイート本文から名詞タグを抽出し、カテゴリキーワードとの照合でカテゴリを自動付与する。crawler・viewer と同じ `data/db.sqlite` を共有する。

### 主要モジュール

- `core/tagger.ts` — kuromoji トークナイザを初期化し、本文から名詞タグを抽出。品詞詳細のホワイトリスト (`一般`・`固有名詞`・`サ変接続`・`ナイ形容詞語幹`) で絞り込み、英語ストップワードを除外する。
- `core/categorizer.ts` — 抽出タグとカテゴリキーワードを照合。confidence = マッチしたキーワード数 / 総キーワード数 (最小 0.1)。
- `infra/database.ts` — タグ・カテゴリの永続化、IDF ベースのノイズタグ一括削除。

### API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/health` | ヘルスチェック |
| POST | `/analyze` | 本文を解析しタグ・カテゴリを返す (ボディ: `{text}`) |
| POST | `/analyze/prune-noise` | IDF ベースのノイズタグを一括削除 (クエリ: `?threshold=0.25`) |
| GET | `/categories` | カテゴリ一覧 |
| POST | `/categories` | カテゴリ作成 |
| PUT | `/categories/:id` | カテゴリ更新 |
| DELETE | `/categories/:id` | カテゴリ削除 |
| GET | `/tags` | タグ一覧 |

## viewer/frontend の状態管理

| composable | 管理する状態 |
|-----------|-------------|
| `useBookmarks` | ブックマーク一覧・ページネーション・検索・ソート設定 (ソート設定は localStorage 永続化) |
| `useAccounts` | アカウント一覧 |
| `useCrawlStatus` | クロール状態 (10 秒ポーリング)・手動実行 |
| `useFeatures` | 機能フラグ (`GET /api/features`)。analyzer 有効時のみカテゴリ/タグ UI を表示 |
| `useCategories` | カテゴリ一覧・作成・更新・削除 (analyzer 有効時のみ) |

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
| `ANALYZER_URL` | - | analyzer サービスの URL。設定時、クロール完了後に自動分析 (`/analyze`) と IDF ノイズプルーニング (`/analyze/prune-noise`) を実行する |

### viewer/backend

| 変数名 | Dockerfile デフォルト | 説明 |
|--------|----------------------|------|
| `DATA_DIR` | `/data` | SQLite DB (`db.sqlite`) の保存先 |
| `LOG_DIR` | `/data/logs` | ログディレクトリ |
| `VIEWER_PORT` | `3000` | HTTP サーバーポート |
| `CRAWLER_URL` | `http://crawler:3001` | crawler サービスの URL |
| `ANALYZER_URL` | - | analyzer サービスの URL。設定時に `/api/features` が analyzer 有効を返し、`/api/categories`・`/api/tags` を analyzer へプロキシする |

### analyzer（任意）

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `DATA_DIR` | `/data` | SQLite DB (`db.sqlite`) の保存先 (crawler・viewer と共有) |
| `ANALYZER_PORT` | `3002` | HTTP サーバーポート |

## Docker ビルド

### crawler — 2 ステージビルド

1. **builder** (`node:24-alpine`): better-sqlite3 のネイティブモジュールをコンパイル。`pnpm deploy` でスタンドアロンパッケージを生成
2. **runner** (`node:24-alpine`): tzdata・ライブラリのみインストール。`tsx src/main.ts` で起動

### viewer — 3 ステージビルド

1. **frontend-builder**: Vite でフロントエンドをビルドし `dist/` を出力
2. **backend-builder**: バックエンドの依存をインストールし、`dist/` を `public/` にコピー
3. **runner**: バックエンドを起動。`public/` の静的ファイルも配信し、SPA フォールバックで `index.html` を返す

### analyzer（任意）

`analyzer/Dockerfile` でビルドする。kuromoji の辞書を同梱し、`tsx src/main.ts` で起動する。Docker Compose では `analyzer` プロファイル指定時のみ起動する（`docker compose --profile analyzer up -d`）。

各コンテナともタイムゾーンは `Asia/Tokyo` に設定されている。

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

- `crawler`、`viewer/backend`、`viewer/frontend`、`analyzer` それぞれで `pnpm lint`

ローカルで `pnpm lint` がパスしない場合は `pnpm fix` で自動修正後、再度確認すること。
