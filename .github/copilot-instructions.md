# GitHub Copilot Instructions

このファイルは GitHub Copilot のコードレビュー機能向けの指示です。開発手順の詳細は `CLAUDE.md` を参照してください。ここではレビュー時に重点確認すべき点に絞ります。

## プロジェクト概要

複数の Twitter/X アカウントのブックマークを収集し、Twitter 風 Web UI で閲覧するアプリ。TypeScript の pnpm workspace モノレポで、`crawler`（収集）・`viewer/backend`（API）・`viewer/frontend`（Vue 3 UI）・`analyzer`（任意のタグ/カテゴリ分類）・`shared`（共有型・SQLite DDL）で構成される。

## 強制されている規約（lint で検査）

各パッケージの `pnpm lint` は Prettier チェック・ESLint・`tsc --noEmit` を実行する。以下は自動検査されるため、レビューでは lint に任せてよい:

- Prettier: セミコロンなし（`semi: false`）、シングルクォート、`printWidth: 80`、末尾カンマは ES5。
- ESLint: `@book000/eslint-config`。
- 型チェック: `tsc --noEmit`。`skipLibCheck` を `true` にする変更は**必ず指摘する**（このリポジトリでは禁止）。

## レビュー時の重点確認

- **SQL インジェクション**: DB クエリはパラメータ化する。ソート・オーダー・検索対象などユーザー入力に基づく識別子はホワイトリストで検証する（`viewer/backend/src/infra/database.ts` 参照）。文字列連結でクエリを組み立てる変更は指摘する。
- **認証・機密情報**: `data/config.json`（Twitter 認証情報）・`data/cookies-*.json`・`.env`・`data/db.sqlite` をコミットに含めていないか。Cookie・トークン・パスワードをログ出力していないか。
- **エラーハンドリング**: crawler の認証（`infra/auth.ts` の戦略ローテーション）・レートリミット（`shared/retry.ts` の 429/403 待機）で、失敗時のリトライ・待機が握り潰されていないか。
- **並行処理**: `viewer/frontend` の `useBookmarks` は並行フェッチの競合を cancel フラグで防いでいる。フェッチ結果の反映順序を壊す変更に注意する。
- **外部サービス連携**: analyzer は任意機能。`ANALYZER_URL` 未設定時に例外を投げず握り潰す設計（crawler・viewer/backend のプロキシ）を壊していないか。
- **ドキュメント整合性**: 環境変数・API・DB スキーマ・サービス構成を変更した場合、`README.md` と `CLAUDE.md` の該当箇所も更新されているか。

## フラグすべきでない既知パターン（誤検知防止）

- **日本語のコメント・JSDoc**: 関数・インターフェースの JSDoc とコード内コメントは日本語で書く方針。エラーメッセージのみ英語。日本語コメントを英語化する提案はしない。
- **日本語と英数字の間の半角スペース**: 意図的な表記ルール。除去を提案しない。
- **analyzer 用テーブルの存在チェック**: `viewer/backend` が `tweet_tags`・`tweet_categories` 等の存在を実行時に確認してクエリを分岐するのは、analyzer がオプショナルで当該テーブルが無い場合があるため。冗長・デッドコードとして指摘しない。
- **`better-sqlite3` の同期 API**: 同期呼び出しは意図的（このプロジェクトの想定負荷では問題ない）。async 化を一律に提案しない。

## コミット / PR

- Conventional Commits に従う。description は日本語。
