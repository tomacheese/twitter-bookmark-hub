import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { KuromojiTokenizer } from "../core/tagger";
import type { AnalyzeResponse } from "@twitter-bookmark-hub/shared";
import { extractNouns } from "../core/tagger";
import { matchCategories } from "../core/categorizer";
import { getCategoryKeywords } from "../infra/database";

/**
 * 分析 API ルートを作成する
 * @param db - Database インスタンス
 * @param tokenizer - kuromoji トークナイザー
 * @returns Hono アプリケーション
 */
export function analyzeRoute(
  db: Database.Database,
  tokenizer: KuromojiTokenizer,
): Hono {
  const app = new Hono();

  /**
   * POST /analyze - ツイートテキストを形態素解析してタグとカテゴリを返す
   * リクエストボディ: { text: string }
   */
  app.post("/analyze", async (c) => {
    const body = await c.req.json<{ text?: string }>();
    const text = body.text;

    if (typeof text !== "string" || text.trim() === "") {
      return c.json({ error: "text is required" }, 400);
    }

    const tags = extractNouns(tokenizer, text);
    const categoryDefs = getCategoryKeywords(db);
    const categories = matchCategories(tags, categoryDefs);

    const response: AnalyzeResponse = { tags, categories };
    return c.json(response);
  });

  return app;
}
