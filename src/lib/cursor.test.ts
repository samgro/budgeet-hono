import { describe, expect, test } from "bun:test"
import { decodeCursor, encodeCursor, InvalidCursorError } from "./cursor"

describe("encodeCursor / decodeCursor", () => {
  test("round-trips a plain cursor", () => {
    const cursor = { date: "2026-03-01", id: "txn-1" }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  test("round-trips ids containing delimiter-like characters", () => {
    for (const id of ["txn,1", "txn:1", "txn|1", "txn/1", "txn+1", "txn=1", 'txn"1', "txn-café"]) {
      const cursor = { date: "2026-03-01", id }
      expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    }
  })

  test("the encoded token is URL-safe", () => {
    const token = encodeCursor({ date: "2026-03-01", id: "txn/+=weird" })
    expect(token).not.toMatch(/[+/=]/)
  })

  test("garbage input throws InvalidCursorError", () => {
    expect(() => decodeCursor("not base64!!!")).toThrow(InvalidCursorError)
  })

  test("a JSON array instead of an object throws", () => {
    const token = Buffer.from("[1,2]", "utf8").toString("base64url")
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  test("an invalid date throws", () => {
    const token = Buffer.from(JSON.stringify({ date: "not-a-date", id: "txn-1" }), "utf8").toString(
      "base64url",
    )
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  test("a missing id throws", () => {
    const token = Buffer.from(JSON.stringify({ date: "2026-03-01" }), "utf8").toString("base64url")
    expect(() => decodeCursor(token)).toThrow(InvalidCursorError)
  })

  test("extra keys are dropped rather than rejected", () => {
    const token = Buffer.from(
      JSON.stringify({ date: "2026-03-01", id: "txn-1", future: 1 }),
      "utf8",
    ).toString("base64url")
    expect(decodeCursor(token)).toEqual({ date: "2026-03-01", id: "txn-1" })
  })
})
