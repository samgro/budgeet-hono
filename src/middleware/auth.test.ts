import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { bearerAuth } from "./auth"

const TOKEN = "known-token"

function testApp() {
  const app = new Hono()
  app.use("*", bearerAuth(TOKEN))
  app.get("/", (c) => c.json({ ok: true }))
  return app
}

describe("bearerAuth", () => {
  test("missing Authorization header → 401", async () => {
    const res = await testApp().request("/")
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: { code: "UNAUTHORIZED", message: "Bad or missing token" } })
  })

  test("wrong scheme → 401", async () => {
    const res = await testApp().request("/", { headers: { authorization: "Basic abc" } })
    expect(res.status).toBe(401)
  })

  test("wrong-length token → 401, not 500", async () => {
    const res = await testApp().request("/", { headers: { authorization: "Bearer short" } })
    expect(res.status).toBe(401)
  })

  test("same-length wrong token → 401", async () => {
    const wrong = "x".repeat(TOKEN.length)
    const res = await testApp().request("/", { headers: { authorization: `Bearer ${wrong}` } })
    expect(res.status).toBe(401)
  })

  test("correct token → 200", async () => {
    const res = await testApp().request("/", { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
