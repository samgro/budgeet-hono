// Full app via createApp, same shape as routes/health.test.ts - exercises
// auth, notFound, and onError for real, plus the route's own parsing. Depth
// lives in lib/accounts.test.ts; these stay thin.

import { describe, expect, test } from "bun:test"
import { createApp } from "../app"
import type { DatabaseClient } from "../db/client"
import { accounts } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import type { SheetsClient } from "../lib/sheets"

const TOKEN = "test-token"

const sheetsClient: SheetsClient = {
  fetchTillerSheets: async () => ({ transactionRows: [], accountRows: [] }),
}

async function seededDatabase() {
  const testDatabase = await createTestDatabase()
  await testDatabase.insert(accounts).values([
    {
      id: "account-visible",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    },
    {
      id: "account-hidden",
      rawName: "Old Card",
      rawInstitution: "Amex",
      rawType: "credit",
      rawClass: "liability",
      ugcIsHidden: true,
    },
  ])
  // PGlite genuinely satisfies the Database interface createAccountsRoute
  // takes; it just isn't a pooled DatabaseClient, and /accounts never
  // touches $client. The cast is confined to satisfying createApp's signature
  // so auth, notFound, and onError are all exercised for real.
  return testDatabase as unknown as DatabaseClient
}

describe("GET /accounts", () => {
  test("without a token → 401", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/accounts")
    expect(response.status).toBe(401)
  })

  test("with a valid token → 200 with accounts, hidden excluded", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/accounts", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      accounts: [{ id: "account-visible", name: "Chase Checking" }],
    })
  })

  test("?includeHidden=yes → 400 BAD_REQUEST", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/accounts?includeHidden=yes", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } })
  })

  test("?includeHidden=true → returns the hidden account too", async () => {
    const app = createApp(TOKEN, await seededDatabase(), sheetsClient)
    const response = await app.request("/accounts?includeHidden=true", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { accounts: Array<{ id: string }> }
    expect(body.accounts.map((account) => account.id)).toContain("account-hidden")
  })
})
