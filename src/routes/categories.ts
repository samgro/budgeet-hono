// Thin, per CLAUDE.md — the grouping logic lives in lib/categories.ts. No
// query params to parse, so no try/catch: an unexpected failure falls
// through to app.onError.

import { Hono } from "hono"
import type { Database } from "../db/client"
import { listCategories } from "../lib/categories"

export function createCategoriesRoute(database: Database) {
  const categories = new Hono()

  categories.get("/", async (context) => context.json(await listCategories(database)))

  return categories
}
