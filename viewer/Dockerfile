# ---- Stage 1: フロントエンドのビルド ----
FROM node:24-alpine AS frontend-builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

RUN npm install -g corepack@latest && corepack enable

WORKDIR /app/frontend

COPY viewer/frontend/package.json viewer/frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-frontend,target=/pnpm/store pnpm fetch
RUN --mount=type=cache,id=pnpm-frontend,target=/pnpm/store pnpm install --offline --frozen-lockfile

COPY viewer/frontend/ ./
RUN pnpm build

# ---- Stage 2: バックエンド + 静的ファイル ----
FROM node:24-alpine

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

RUN apk add --no-cache tzdata python3 make g++ && \
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

RUN --mount=type=cache,id=pnpm-backend,target=/pnpm/store pnpm fetch

# shared パッケージのソースをコピー（workspace リンクに必要）
COPY shared/ ./shared/

RUN --mount=type=cache,id=pnpm-backend,target=/pnpm/store pnpm install --offline --frozen-lockfile --filter twitter-bookmark-hub-backend

COPY viewer/backend/tsconfig.json ./viewer/backend/
COPY viewer/backend/src/ ./viewer/backend/src/
COPY --from=frontend-builder /app/frontend/dist ./viewer/backend/public

WORKDIR /app/viewer/backend
CMD ["pnpm", "start"]
