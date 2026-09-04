import { describe, expect, test } from "bun:test"
import { classifySheetsError, decodeServiceAccount } from "./sheets"

function toBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64")
}

describe("decodeServiceAccount", () => {
  test("decodes a base64-encoded service account JSON blob", () => {
    const credentials = decodeServiceAccount(
      toBase64({
        client_email: "sync@budgeet.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
        project_id: "budgeet",
      }),
    )
    expect(credentials.client_email).toBe("sync@budgeet.iam.gserviceaccount.com")
    expect(credentials.private_key).toContain("BEGIN PRIVATE KEY")
  })

  test("missing client_email → throws", () => {
    expect(() => decodeServiceAccount(toBase64({ private_key: "abc" }))).toThrow()
  })

  test("missing private_key → throws", () => {
    expect(() =>
      decodeServiceAccount(toBase64({ client_email: "sync@budgeet.iam.gserviceaccount.com" })),
    ).toThrow()
  })

  test("invalid base64/JSON → throws, not a silent garbage object", () => {
    expect(() => decodeServiceAccount("not-valid-base64-json")).toThrow()
  })
})

describe("classifySheetsError", () => {
  test("401 → auth", () => {
    expect(classifySheetsError({ status: 401, message: "invalid_grant" }).kind).toBe("auth")
  })

  test("403 → auth", () => {
    expect(classifySheetsError({ status: 403, message: "forbidden" }).kind).toBe("auth")
  })

  test("429 → quota", () => {
    expect(classifySheetsError({ status: 429, message: "rateLimitExceeded" }).kind).toBe("quota")
  })

  test("status nested under response.status is read the same way", () => {
    expect(classifySheetsError({ response: { status: 429 } }).kind).toBe("quota")
  })

  test("500 → unavailable", () => {
    expect(classifySheetsError({ status: 500, message: "backend error" }).kind).toBe("unavailable")
  })

  test("no status at all → unavailable, not a throw", () => {
    expect(classifySheetsError(new Error("network down")).kind).toBe("unavailable")
  })

  test("a non-object thrown value is still classified, not re-thrown", () => {
    expect(classifySheetsError("boom").kind).toBe("unavailable")
  })
})
