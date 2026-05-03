# ---- Stage 1: ビルドとデプロイパッケージの作成 ----
FROM node:24-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# better-sqlite3 のネイティブモジュールコンパイルに必要
RUN apk add --no-cache python3 make g++ gcompat libc6-compat && \
    corepack enable

WORKDIR /app

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY crawler/package.json ./crawler/
COPY viewer/frontend/package.json ./viewer/frontend/
COPY viewer/backend/package.json ./viewer/backend/
COPY analyzer/package.json ./analyzer/

RUN --mount=type=cache,id=pnpm-analyzer,target=/pnpm/store pnpm fetch

COPY shared/ ./shared/

RUN --mount=type=cache,id=pnpm-analyzer,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter twitter-bookmark-hub-analyzer

COPY analyzer/ ./analyzer/

# pnpm v11 以降では inject-workspace-packages がロックファイルに記録されなくなったため --legacy フラグが必要
RUN pnpm --filter twitter-bookmark-hub-analyzer deploy --legacy /deploy

# ---- Stage 2: ランタイム ----
FROM node:24-alpine AS runner

RUN apk add --no-cache tzdata gcompat libc6-compat && \
    cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    echo "Asia/Tokyo" > /etc/timezone

WORKDIR /app

ENV DATA_DIR=/data \
    LOG_DIR=/data/logs \
    ANALYZER_PORT=3002

COPY --from=builder /deploy .

CMD ["node_modules/.bin/tsx", "src/main.ts"]
