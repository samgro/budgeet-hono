import { describe, expect, test } from "bun:test"
import { isIsoDate } from "./dates"

describe("isIsoDate", () => {
  test("a valid date → true", () => {
    expect(isIsoDate("2026-03-01")).toBe(true)
  })

  test("a leap day in a leap year → true", () => {
    expect(isIsoDate("2024-02-29")).toBe(true)
  })

  test("a leap day in a non-leap year → false", () => {
    expect(isIsoDate("2026-02-29")).toBe(false)
  })

  test("day 31 of a 30-day month → false", () => {
    expect(isIsoDate("2026-02-31")).toBe(false)
  })

  test("month 13 → false", () => {
    expect(isIsoDate("2026-13-01")).toBe(false)
  })

  test("unpadded month/day → false", () => {
    expect(isIsoDate("2026-3-1")).toBe(false)
  })

  test("empty string → false", () => {
    expect(isIsoDate("")).toBe(false)
  })

  test("a full timestamp → false", () => {
    expect(isIsoDate("2026-03-01T00:00:00Z")).toBe(false)
  })
})
