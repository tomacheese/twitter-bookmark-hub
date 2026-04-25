# ---- Stage 1: フロントエンドのビルド ----
FROM node:24-alpine AS frontend-builder

# pnpm のホームディレクトリを設定し PATH に追加する
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ネイティブモジュールのコンパイルに必要なツールをインストール
# @twitter-bookmark-hub/shared が workspace:* 参照のためルート workspace 全体をフェッチする際に
# better-sqlite3 など他パッケージの install スクリプトが実行されるため必要
# corepack は Node.js 24 に同梱済みのため npm install 不要
RUN apk add --no-cache python3 make g++ gcompat libc6-compat && \
    corepack enable

WORKDIR /app

# ワークスペースの依存解決に必要なファイルをコピー（レイヤーキャッシュ最適化）
# @twitter-bookmark-hub/shared が workspace:* 参照のため、ルートの設定ファイルが必要
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY crawler/package.json ./crawler/
COPY viewer/frontend/package.json ./viewer/frontend/
COPY viewer/backend/package.json ./viewer/backend/

# ロックファイルからパッケージをストアにフェッチ（ネットワーク層をキャッシュ）
# crawler/backend と同一の pnpm-store キャッシュを共有し、重複ダウンロードを防ぐ
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# shared パッケージのソースをコピー（workspace リンクに必要）
COPY shared/ ./shared/

# frontend の全依存パッケージをインストール
# node-gyp キャッシュを共有してネイティブモジュールの再コンパイルを防ぐ
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=node-gyp,target=/root/.cache/node-gyp \
    pnpm install --offline --frozen-lockfile --filter twitter-bookmark-hub-frontend

# frontend のソースをコピーしてビルド
COPY viewer/frontend/ ./viewer/frontend/
RUN pnpm --filter twitter-bookmark-hub-frontend build

# ---- Stage 2: ネイティブモジュールのビルドとデプロイパッケージの作成 ----
FROM node:24-alpine AS backend-builder

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
# frontend と同一の pnpm-store キャッシュを共有し、重複ダウンロードを防ぐ
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# shared パッケージのソースをコピー（workspace リンクに必要）
COPY shared/ ./shared/

# backend の全依存パッケージをインストール（ネイティブモジュールをここでコンパイル）
# node-gyp キャッシュを共有して better-sqlite3 の再コンパイルを防ぐ
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,id=node-gyp,target=/root/.cache/node-gyp \
    pnpm install --offline --frozen-lockfile --filter twitter-bookmark-hub-backend

# backend のソースとフロントエンドのビルド成果物をコピー
COPY viewer/backend/ ./viewer/backend/
COPY --from=frontend-builder /app/viewer/frontend/dist ./viewer/backend/public

# devDependencies を除いた本番環境用スタンドアローンパッケージを作成する
# pnpm v11 以降では inject-workspace-packages がロックファイルに記録されなくなったため --legacy フラグが必要
RUN pnpm --filter twitter-bookmark-hub-backend deploy --legacy /deploy

# ---- Stage 3: ランタイム ----
FROM node:24-alpine AS runner

# タイムゾーンの設定とネイティブモジュールの実行に必要なライブラリをインストール
RUN apk add --no-cache tzdata gcompat libc6-compat && \
    cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    echo "Asia/Tokyo" > /etc/timezone

WORKDIR /app

# プロジェクトのデフォルト環境変数（docker run -e や compose で上書き可能）
ENV DATA_DIR=/data \
    LOG_DIR=/data/logs \
    VIEWER_PORT=3000 \
    CRAWLER_URL=http://crawler:3001

# backend-builder ステージで作成したスタンドアローンパッケージをコピー
COPY --from=backend-builder /deploy .

CMD ["node_modules/.bin/tsx", "src/main.ts"]
