import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { bearerAuth } from "./auth"

const TOKEN = "known-token"

function testApp() {
  const app = new Hono()
  app.use("*", bearerAuth(TOKEN))
  app.get("/", (context) => context.json({ ok: true }))
  return app
}

describe("bearerAuth", () => {
  test("missing Authorization header → 401", async () => {
    const response = await testApp().request("/")
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toEqual({ error: { code: "UNAUTHORIZED", message: "Bad or missing token" } })
  })

  test("wrong scheme → 401", async () => {
    const response = await testApp().request("/", { headers: { authorization: "Basic abc" } })
    expect(response.status).toBe(401)
  })

  test("wrong-length token → 401, not 500", async () => {
    const response = await testApp().request("/", { headers: { authorization: "Bearer short" } })
    expect(response.status).toBe(401)
  })

  test("same-length wrong token → 401", async () => {
    const wrong = "x".repeat(TOKEN.length)
    const response = await testApp().request("/", {
      headers: { authorization: `Bearer ${wrong}` },
    })
    expect(response.status).toBe(401)
  })

  test("correct token → 200", async () => {
    const response = await testApp().request("/", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
