# ---- Stage 1: フロントエンドのビルド ----
FROM node:24-alpine AS frontend-builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

RUN npm install -g corepack@latest && corepack enable

WORKDIR /app/frontend

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-frontend,target=/pnpm/store pnpm fetch
RUN --mount=type=cache,id=pnpm-frontend,target=/pnpm/store pnpm install --offline --frozen-lockfile

COPY frontend/ ./
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

COPY backend/package.json backend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-backend,target=/pnpm/store pnpm fetch
RUN --mount=type=cache,id=pnpm-backend,target=/pnpm/store pnpm install --offline --frozen-lockfile

COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./public

CMD ["pnpm", "start"]
