// Full app via createApp, same shape as routes/health.test.ts. Depth lives in
// lib/categories.test.ts; this stays thin.

import { describe, expect, test } from "bun:test"
import { createApp } from "../app"
import type { DatabaseClient } from "../db/client"
import { categories } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import type { SheetsClient } from "../lib/sheets"

const TOKEN = "test-token"

const sheetsClient: SheetsClient = {
  fetchTillerSheets: async () => ({ transactionRows: [], accountRows: [] }),
}

async function seededDatabase() {
  const testDatabase = await createTestDatabase()
  await testDatabase.insert(categories).values({
    detailed: "FOOD_AND_DRINK_COFFEE",
    name: "Coffee Shops",
    primary: "FOOD_AND_DRINK",
    primaryName: "Food & Drink",
  })
  // PGlite genuinely satisfies the Database interface createCategoriesRoute
  // takes; it just isn't a pooled DatabaseClient, and /categories never
  // touches $client. The cast is confined to satisfying createApp's signature
  // so auth, notFound, and onError are all exercised for real.
  return testDatabase as unknown as DatabaseClient
}

describe("GET /categories", () => {
  test("without a token → 401", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/categories")
    expect(response.status).toBe(401)
  })

  test("with a valid token → 200 with grouped categories", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/categories", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      categories: [
        {
          primary: { id: "FOOD_AND_DRINK", name: "Food & Drink" },
          detailed: [{ id: "FOOD_AND_DRINK_COFFEE", name: "Coffee Shops" }],
        },
      ],
    })
  })
})
