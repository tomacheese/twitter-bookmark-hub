import { Hono } from "hono";
import type Database from "better-sqlite3";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../infra/database";

/**
 * カテゴリ CRUD ルートを作成する
 * @param db - Database インスタンス
 * @returns Hono アプリケーション
 */
export function categoriesRoute(db: Database.Database): Hono {
  const app = new Hono();

  /** GET /categories - カテゴリ一覧を取得する */
  app.get("/categories", (c) => {
    return c.json(getCategories(db));
  });

  /** POST /categories - カテゴリを作成する */
  app.post("/categories", async (c) => {
    const body = await c.req.json<{
      name?: string;
      color?: string;
      keywords?: string[];
    }>();

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return c.json({ error: "name is required" }, 400);
    }

    const name = body.name.trim();
    const color = typeof body.color === "string" ? body.color : "#6B7280";
    const keywords = Array.isArray(body.keywords) ? body.keywords : [];

    const id = createCategory(db, name, color, keywords);
    const categories = getCategories(db);
    const created = categories.find((cat) => cat.id === id);
    return c.json(created, 201);
  });

  /** PUT /categories/:id - カテゴリを更新する */
  app.put("/categories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{
      name?: string;
      color?: string;
      keywords?: string[];
    }>();

    if (typeof body.name !== "string" || body.name.trim() === "") {
      return c.json({ error: "name is required" }, 400);
    }

    const name = body.name.trim();
    const color = typeof body.color === "string" ? body.color : "#6B7280";
    const keywords = Array.isArray(body.keywords) ? body.keywords : [];

    updateCategory(db, id, name, color, keywords);
    const categories = getCategories(db);
    const updated = categories.find((cat) => cat.id === id);
    if (!updated) {
      return c.json({ error: "Category not found" }, 404);
    }
    return c.json(updated);
  });

  /** DELETE /categories/:id - カテゴリを削除する */
  app.delete("/categories/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }
    deleteCategory(db, id);
    return c.body(null, 204);
  });

  return app;
}
