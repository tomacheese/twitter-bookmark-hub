# Twitter Bookmark Hub

複数の Twitter アカウントのブックマークを収集・閲覧するアプリケーション。

## 概要

- **crawler**: 全アカウントのブックマークを定期取得し SQLite に保存
- **viewer**: 収集したブックマークを Twitter 風 UI で一覧表示

## 前提条件

- Docker / Docker Compose
- `data/config.json` (アカウント設定ファイル)

## セットアップ

### 1. アカウント設定

`data/config.json` を作成してください:

```json
{
  "twitter": {
    "accounts": [
      {
        "email": "your-email@example.com",
        "username": "your_username",
        "password": "your_password",
        "otp_secret": null
      }
    ]
  }
}
```

> `otp_secret` は 2 段階認証 (TOTP) を使用している場合に設定します。

### 2. 環境変数の設定 (任意)

```bash
cp .env.example .env
# .env を編集して設定をカスタマイズ
```

### 3. 起動

```bash
docker compose up -d
```

## アクセス

| サービス | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| Crawler API | http://localhost:3001 |

## 環境変数

### crawler

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CRAWL_SCHEDULE` | `0 * * * *` | クロールスケジュール (cron 式、デフォルト: 1 時間毎) |
| `CRAWL_ON_STARTUP` | `true` | 起動時に即クロール実行 |
| `PROXY_SERVER` | - | プロキシサーバー |
| `PROXY_USERNAME` | - | プロキシ認証ユーザー名 |
| `PROXY_PASSWORD` | - | プロキシ認証パスワード |

### viewer

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CRAWLER_URL` | `http://crawler:3001` | crawler サービスの URL |

## Crawler API

| エンドポイント | メソッド | 説明 |
|--------------|---------|------|
| `/health` | GET | ヘルスチェック |
| `/crawl` | POST | クロール手動実行 |
| `/crawl/status` | GET | 最新クロールジョブの状態 |

## データ

`data/` ディレクトリに以下が保存されます:

| ファイル | 説明 |
|---------|------|
| `config.json` | アカウント設定 |
| `db.sqlite` | ブックマーク DB |
| `cookies-{username}.json` | Cookie キャッシュ (7 日間有効) |
