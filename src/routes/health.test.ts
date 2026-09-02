import { describe, expect, test } from "bun:test"
import { createApp } from "../app"

const TOKEN = "test-token"

describe("GET /health", () => {
  test("with a valid token → 200 { ok: true }", async () => {
    const app = createApp(TOKEN)
    const res = await app.request("/health", { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test("without a token → 401", async () => {
    const app = createApp(TOKEN)
    const res = await app.request("/health")
    expect(res.status).toBe(401)
  })
})

describe("unknown route", () => {
  test("→ 404 in the standard error shape", async () => {
    const app = createApp(TOKEN)
    const res = await app.request("/nope", { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "No such route" } })
  })
})
