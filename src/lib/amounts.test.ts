import { describe, expect, test } from "bun:test"
import { parseTillerAmount, parseTillerBalance } from "./amounts"

describe("parseTillerAmount", () => {
  test("spec case: -$1,234.56 -> 1234.56 (expense flips to outflow-positive)", () => {
    expect(parseTillerAmount("-$1,234.56")).toBe("1234.56")
  })

  test("spec case: $10,000.00 -> -10000.00 (deposit flips to inflow-negative)", () => {
    expect(parseTillerAmount("$10,000.00")).toBe("-10000.00")
  })

  test("no negative-zero artifact", () => {
    expect(parseTillerAmount("-$0.00")).toBe("0.00")
    expect(parseTillerAmount("$0.00")).toBe("0.00")
  })

  test("blank is rejected, not silently imported as $0.00", () => {
    expect(() => parseTillerAmount("")).toThrow()
    expect(() => parseTillerAmount("   ")).toThrow()
  })

  test("unparseable value throws rather than coercing to NaN", () => {
    expect(() => parseTillerAmount("not a number")).toThrow()
  })
})

describe("parseTillerBalance", () => {
  test("parses without flipping sign - a balance is not a transaction", () => {
    expect(parseTillerBalance("$22.97")).toBe("22.97")
  })

  test("a negative balance (credit card owed) stays negative", () => {
    expect(parseTillerBalance("-$500.00")).toBe("-500.00")
  })

  test("blank is legitimate and maps to null, not a throw", () => {
    expect(parseTillerBalance("")).toBeNull()
  })
})
