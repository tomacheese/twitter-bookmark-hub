import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { KuromojiTokenizer } from "./core/tagger";
import { analyzeRoute } from "./routes/analyze";
import { categoriesRoute } from "./routes/categories";
import { tagsRoute } from "./routes/tags";

/**
 * Hono サーバーを作成する
 * @param db - Database インスタンス
 * @param tokenizer - kuromoji トークナイザー
 * @returns 設定済みの Hono アプリケーション
 */
export function createServer(
  db: Database.Database,
  tokenizer: KuromojiTokenizer,
): Hono {
  const app = new Hono();

  app.route("/", analyzeRoute(db, tokenizer));
  app.route("/", categoriesRoute(db));
  app.route("/", tagsRoute(db));

  app.get("/health", (c) =>
    c.json({ status: "ok", timestamp: new Date().toISOString() }),
  );

  return app;
}
