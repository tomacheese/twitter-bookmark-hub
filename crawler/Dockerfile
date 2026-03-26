FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

RUN apk add --no-cache tzdata python3 make g++ gcompat libc6-compat && \
    cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    echo "Asia/Tokyo" > /etc/timezone && \
    npm install -g corepack@latest && \
    corepack enable

WORKDIR /app

# ワークスペースの依存解決に必要なファイルをコピー
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY crawler/package.json ./crawler/
COPY viewer/frontend/package.json ./viewer/frontend/
COPY viewer/backend/package.json ./viewer/backend/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

# shared パッケージのソースをコピー（workspace リンクに必要）
COPY shared/ ./shared/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter twitter-bookmark-hub-crawler

COPY crawler/tsconfig.json ./crawler/
COPY crawler/src/ ./crawler/src/

WORKDIR /app/crawler
CMD ["pnpm", "start"]
