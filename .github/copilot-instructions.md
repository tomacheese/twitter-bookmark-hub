# GitHub Copilot Instructions

## プロジェクト概要
- 目的: 複数の Twitter/X アカウントのブックマークを自動収集し、一元的に閲覧する
- 主な機能: マルチアカウント対応ブックマーク収集、SQLite 保存、Twitter 風 Web UI での閲覧
- 対象ユーザー: 複数の Twitter アカウントを持つ開発者

## リポジトリ構成
- `crawler/` — ブックマーク収集サービス（Node.js + Hono + SQLite）
- `viewer/backend/` — 閲覧 API サーバー（Node.js + Hono + SQLite）
- `viewer/frontend/` — Web UI（Vue 3 + Vite）
- `compose.yaml` — Docker Compose によるサービス起動定義

## 共通ルール
- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。
- 日本語と英数字の間には半角スペースを入れる。
- エラーメッセージは英語で記載する。

## 技術スタック
- 言語: TypeScript（crawler・backend）、Vue 3 + TypeScript（frontend）
- ランタイム: Node.js (v24)
- パッケージマネージャー: pnpm
- 主要ライブラリ:
  - crawler: `twitter-openapi-typescript`, `@the-convocation/twitter-scraper`, `cycletls`, `better-sqlite3`, `hono`
  - backend: `better-sqlite3`, `hono`
  - frontend: `vue`, `vite`

## コーディング規約
- フォーマット: Prettier
- Lint: ESLint (`@book000/eslint-config`)
- 関数・インターフェースには日本語で JSDoc を記載する。
- TypeScript の `skipLibCheck` は使用しない。

## 開発コマンド

### crawler
```bash
cd crawler
pnpm install
pnpm start   # 実行
pnpm lint    # Lint チェック
pnpm fix     # 自動修正
```

### viewer/backend
```bash
cd viewer/backend
pnpm install
pnpm start   # 実行
pnpm lint    # Lint チェック
pnpm fix     # 自動修正
```

### viewer/frontend
```bash
cd viewer/frontend
pnpm install
pnpm dev     # 開発サーバー起動
pnpm build   # プロダクションビルド
pnpm lint    # Lint チェック
pnpm fix     # 自動修正
```

### Docker Compose（全サービス起動）
```bash
docker compose up -d
```

## セキュリティ / 機密情報
- `data/config.json` に含まれる Twitter 認証情報（パスワード・OTP シークレット）はコミットしない。
- `data/cookies-*.json` の Cookie ファイルはコミットしない。
- `.env` に含まれる環境変数はコミットしない（`.env.example` のみコミット可）。

## ドキュメント更新
- `README.md`（仕様変更・環境変数追加時）

## リポジトリ固有
- Docker Compose での実行を主とする（`docker compose up -d`）。
- データは `data/` ディレクトリに保存される（`.gitignore` 済み）。
- crawler は HTTP API（port 3001）を持ち、viewer backend からクロール状態を参照する。
- viewer は port 3000 で Web UI を提供する。
