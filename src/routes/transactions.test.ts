// Full app via createApp, same shape as routes/health.test.ts - exercises
// auth, notFound, and onError for real, plus the route's own parsing/shaping.

import { describe, expect, test } from "bun:test"
import { createApp } from "../app"
import type { DatabaseClient } from "../db/client"
import { accounts, transactions } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import type { SheetsClient } from "../lib/sheets"

const TOKEN = "test-token"

const sheetsClient: SheetsClient = {
  fetchTillerSheets: async () => ({ transactionRows: [], accountRows: [] }),
}

async function seededDatabase() {
  const testDatabase = await createTestDatabase()
  await testDatabase.insert(accounts).values({
    id: "account-1",
    rawName: "Checking",
    rawInstitution: "Chase",
    rawType: "checking",
    rawClass: "asset",
  })
  await testDatabase.insert(transactions).values({
    id: "txn-1",
    accountId: "account-1",
    rawDate: "2026-03-01",
    rawAmount: "12.34",
    rawDescription: "Blue Bottle Coffee",
  })
  // PGlite genuinely satisfies the Database interface createTransactionsRoute
  // takes; it just isn't a pooled DatabaseClient, and /transactions never
  // touches $client. The cast is confined to satisfying createApp's signature
  // so auth, notFound, and onError are all exercised for real.
  return testDatabase as unknown as DatabaseClient
}

describe("GET /transactions", () => {
  test("without a token → 401", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/transactions")
    expect(response.status).toBe(401)
  })

  test("with a valid token → 200 with transactions and nextCursor", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/transactions", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      transactions: [{ id: "txn-1", amount: "12.34" }],
      nextCursor: null,
    })
  })

  test("?limit=abc → 400 BAD_REQUEST", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/transactions?limit=abc", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } })
  })

  test("?cursor=garbage → 400 BAD_REQUEST", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/transactions?cursor=garbage", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } })
  })
})

describe("GET /transactions/:id", () => {
  test("a known id → 200 with tags and corrections", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/transactions/txn-1", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "txn-1", tags: [], corrections: [] })
  })

  test("an unknown id → 404 NOT_FOUND", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/transactions/no-such-id", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } })
  })
})
