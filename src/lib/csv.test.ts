import { describe, expect, test } from "bun:test"
import { parseCsv } from "./csv"

describe("parseCsv", () => {
  test("splits a simple comma-separated row", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ])
  })

  test("handles a quoted field containing a comma", () => {
    expect(parseCsv('a,"b, with comma",c\n')).toEqual([["a", "b, with comma", "c"]])
  })

  test("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsv('a,"say ""hi""",c\n')).toEqual([["a", 'say "hi"', "c"]])
  })

  test("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  test("handles a final row with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  test("preserves empty fields", () => {
    expect(parseCsv("a,,c\n")).toEqual([["a", "", "c"]])
  })

  test("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([])
  })
})
