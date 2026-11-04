# GitHub Copilot Instructions

GitHub Copilot のコードレビュー向けの指示です。プロジェクト概要・開発手順・規約・不変条件は `AGENTS.md` を参照してください。ここではレビュー時の重点確認事項に絞ります。

## レビュー時の重点確認

- **lint に任せてよいもの**: Prettier・ESLint（`@book000/eslint-config`）・`tsc --noEmit` は `pnpm lint` で検査される。ただし `skipLibCheck` を `true` にする変更は禁止のため必ず指摘する。
- **SQL インジェクション**: DB クエリはパラメータ化する。ソート・順序・検索対象などユーザー入力に基づく識別子はホワイトリストで検証する （`viewer/backend/src/infra/database.ts` 参照）。文字列連結でクエリを組み立てる変更は指摘する。
- **認証・機密情報**: `data/config.json`・`data/cookies-*.json`・`.env`・`data/db.sqlite` をコミットに含めていないか。Cookie・トークン・パスワードをログ出力していないか。
- **エラーハンドリング**: crawler の認証（`infra/auth.ts` の戦略ローテーション）とレートリミット（`shared/retry.ts` の 429/403 待機）で、リトライ・待機が握り潰されていないか。
- **並行処理**: `viewer/frontend` の `useBookmarks` は並行フェッチの競合を cancel フラグで防いでいる。フェッチ結果の反映順序を壊す変更に注意する。
- **外部サービス連携**: analyzer は任意機能。`ANALYZER_URL` 未設定時に例外を投げず動作し続ける設計を壊していないか。
- **ドキュメント整合性**: 環境変数・API・DB スキーマ・サービス構成を変更した場合、`README.md` と `AGENTS.md` の該当箇所も更新されているか。

## フラグすべきでない既知パターン

- 日本語のコメント・JSDoc、日本語と英数字の間の半角スペース（意図的な方針。英語化・除去を提案しない）。
- `viewer/backend` が `tweet_tags`・`tweet_categories` 等の存在を実行時に確認してクエリを分岐する実装（analyzer が任意のため。冗長・デッドコードとして指摘しない）。
- `better-sqlite3` の同期 API の使用（意図的。一律の async 化を提案しない）。

## コミット / PR

- Conventional Commits に従う。description は日本語。
