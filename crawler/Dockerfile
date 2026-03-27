# ---- Stage 1: ネイティブモジュールのビルドとデプロイパッケージの作成 ----
FROM node:24-alpine AS builder

# pnpm のホームディレクトリを設定し PATH に追加する
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ネイティブモジュール（better-sqlite3）のコンパイルに必要なツールをインストール
# corepack は Node.js 24 に同梱済みのため npm install 不要
RUN apk add --no-cache python3 make g++ gcompat libc6-compat && \
    corepack enable

WORKDIR /app

# ワークスペースの依存解決に必要なファイルをコピー（レイヤーキャッシュ最適化）
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY crawler/package.json ./crawler/
COPY viewer/frontend/package.json ./viewer/frontend/
COPY viewer/backend/package.json ./viewer/backend/

# ロックファイルからパッケージをストアにフェッチ（ネットワーク層をキャッシュ）
RUN --mount=type=cache,id=pnpm-crawler,target=/pnpm/store pnpm fetch

# shared パッケージのソースをコピー（workspace リンクに必要）
COPY shared/ ./shared/

# crawler の全依存パッケージをインストール（ネイティブモジュールをここでコンパイル）
RUN --mount=type=cache,id=pnpm-crawler,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter twitter-bookmark-hub-crawler

# crawler のソースをコピー
COPY crawler/ ./crawler/

# devDependencies を除いた本番環境用スタンドアローンパッケージを作成する
RUN pnpm --filter twitter-bookmark-hub-crawler deploy /deploy

# ---- Stage 2: ランタイム ----
FROM node:24-alpine AS runner

# タイムゾーンの設定とネイティブモジュールの実行に必要なライブラリをインストール
RUN apk add --no-cache tzdata gcompat libc6-compat && \
    cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    echo "Asia/Tokyo" > /etc/timezone

WORKDIR /app

# プロジェクトのデフォルト環境変数（docker run -e や compose で上書き可能）
ENV DATA_DIR=/data \
    LOG_DIR=/data/logs \
    CRAWLER_PORT=3001 \
    CRAWL_SCHEDULE="0 * * * *" \
    CRAWL_ON_STARTUP=true

# builder ステージで作成したスタンドアローンパッケージをコピー
COPY --from=builder /deploy .

CMD ["node_modules/.bin/tsx", "src/main.ts"]
