import { describe, expect, test } from "bun:test"
import { createApp } from "../app"
import type { DatabaseClient } from "../db/client"
import type { SheetsClient } from "../lib/sheets"

const TOKEN = "test-token"

// /health never touches either dependency — these are stubs, not fakes, and
// exist only to satisfy createApp's signature.
const database = {} as DatabaseClient
const sheetsClient: SheetsClient = {
  fetchTillerSheets: async () => ({ transactionRows: [], accountRows: [] }),
}

describe("GET /health", () => {
  test("with a valid token → 200 { ok: true }", async () => {
    const app = createApp(TOKEN, database, sheetsClient)
    const response = await app.request("/health", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test("without a token → 401", async () => {
    const app = createApp(TOKEN, database, sheetsClient)
    const response = await app.request("/health")
    expect(response.status).toBe(401)
  })
})

describe("unknown route", () => {
  test("→ 404 in the standard error shape", async () => {
    const app = createApp(TOKEN, database, sheetsClient)
    const response = await app.request("/nope", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "No such route" },
    })
  })
})
