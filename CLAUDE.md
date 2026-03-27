# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**Twitter Bookmark Hub** — 複数の Twitter/X アカウントのブックマークを自動収集し、一元的に閲覧するアプリケーション。

| サービス | 説明 |
|---------|------|
| `crawler` | 全アカウントのブックマークを定期取得し SQLite に保存 |
| `viewer/backend` | 収集済みブックマークを提供する API サーバー |
| `viewer/frontend` | Twitter 風 Web UI |
| `shared` | crawler・backend 間の共有型定義・スキーマ |

## リポジトリ構成

```
crawler/          # ブックマーク収集サービス
  src/
    core/         # ドメインロジック (crawler.ts)
    infra/        # 外部連携 (auth, bookmarks-api, database, cycletls)
    main.ts       # エントリポイント
    scheduler.ts  # cron スケジューラ
    server.ts     # HTTP API サーバー (Hono)
shared/           # 共有パッケージ
  src/
    schema.ts     # SQLite DDL 定数 (SCHEMA_DDL)
    types.ts      # 型定義
viewer/
  backend/        # 閲覧 API サーバー (Hono + SQLite)
    src/
      routes/     # accounts, bookmarks, crawl エンドポイント
  frontend/       # Web UI (Vue 3 + Vite)
    src/
      components/ # AccountFilter, BookmarkCard, BookmarkList, CrawlStatus
      composables/ # useAccounts, useBookmarks, useCrawlStatus
compose.yaml      # Docker Compose 定義
```

## 技術スタック

| 領域 | 技術 |
|------|------|
| 言語 | TypeScript |
| ランタイム | Node.js v24 |
| パッケージマネージャー | pnpm (workspace モノレポ) |
| crawler / backend フレームワーク | Hono |
| DB | better-sqlite3 (SQLite) |
| frontend フレームワーク | Vue 3 + Vite |
| Twitter API | twitter-openapi-typescript, @the-convocation/twitter-scraper |
| TLS 回避 | cycletls |
| Lint | ESLint (`@book000/eslint-config`) + Prettier |

## 開発コマンド

### 依存パッケージのインストール

```bash
# リポジトリルートで一度実行する (pnpm workspace により全パッケージに適用される)
pnpm install
```

### Lint / フォーマット

```bash
# 各パッケージで実行する
pnpm lint       # ESLint + Prettier + TypeScript 型チェック
pnpm fix        # 自動修正 (ESLint --fix + Prettier --write)
```

CI (`nodejs-ci.yml`) は `crawler`、`viewer/backend`、`viewer/frontend` の 3 ディレクトリで `pnpm lint` を実行する。**PR 前に必ず全パッケージで lint をパスさせること。**

### 起動

```bash
# Docker Compose で全サービス起動（推奨）
docker compose up -d

# 個別起動（開発時）
cd crawler && pnpm start          # port 3001
cd viewer/backend && pnpm start   # ポート 3000 (Docker Compose では外部公開)
cd viewer/frontend && pnpm dev    # Vite dev server
```

## コーディング規約

- **JSDoc**: 関数・インターフェースには日本語で JSDoc を記載する。
- **コメント**: コード内コメントは日本語で記載する。エラーメッセージは英語。
- **日本語と英数字の間**には半角スペースを挿入する。
- **`skipLibCheck`** を `true` にすることは絶対に禁止。
- **フォーマット**: Prettier の設定に従う。
- **Lint**: `@book000/eslint-config` の設定に従う。

## セキュリティ / 機密情報

以下のファイルは絶対にコミットしない:

- `data/config.json` — Twitter 認証情報（パスワード・OTP シークレット）
- `data/cookies-*.json` — Cookie キャッシュ
- `.env` — 環境変数（`.env.example` のみコミット可）
- `data/db.sqlite` — ブックマーク DB

## 環境変数

### crawler

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CRAWL_SCHEDULE` | `0 * * * *` | クロールスケジュール (cron 式) |
| `CRAWL_ON_STARTUP` | `true` | 起動時に即クロール実行 |
| `PROXY_SERVER` | - | プロキシサーバー |
| `PROXY_USERNAME` | - | プロキシ認証ユーザー名 |
| `PROXY_PASSWORD` | - | プロキシ認証パスワード |

### viewer

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CRAWLER_URL` | `http://crawler:3001` | crawler サービスの URL |

## Git 運用

- コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う。`<description>` は日本語で記載する。
- ブランチ名は [Conventional Branch](https://conventional-branch.github.io) に従う。
- `data/`、`.env`、Cookie ファイルなど機密情報を含むファイルはコミットしない。
- **git push は SSH を使用する**（HTTPS は使用しない）。

## CI

GitHub Actions の `nodejs-ci.yml` が PR・push 時に以下を実行する:

- `crawler`、`viewer/backend`、`viewer/frontend` それぞれで `pnpm lint`

ローカルで `pnpm lint` がパスしない場合は `pnpm fix` で自動修正後、再度確認すること。
