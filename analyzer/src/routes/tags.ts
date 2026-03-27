import { Hono } from "hono";
import type Database from "better-sqlite3";
import { getTopTags } from "../infra/database";

/**
 * タグ API ルートを作成する
 * @param db - Database インスタンス
 * @returns Hono アプリケーション
 */
export function tagsRoute(db: Database.Database): Hono {
  const app = new Hono();

  /** GET /tags - 頻出タグ一覧を取得する（カテゴリ定義 UI のサジェスト用） */
  app.get("/tags", (c) => {
    const rawLimit = Number(c.req.query("limit") ?? "50");
    const limit = Math.min(
      200,
      Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50),
    );
    return c.json(getTopTags(db, limit));
  });

  return app;
}
