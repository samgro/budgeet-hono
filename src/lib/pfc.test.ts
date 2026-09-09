import { describe, expect, test } from "bun:test"
import { parsePfcTaxonomy } from "./pfc"

// Runs against the real committed CSV (src/db/seeds/pfc-taxonomy-all.csv) -
// this is the exact input the seed script parses, not a fixture that can drift
// from it.
const csvPath = new URL("../db/seeds/pfc-taxonomy-all.csv", import.meta.url)
const csvText = await Bun.file(csvPath).text()

describe("parsePfcTaxonomy", () => {
  const categories = parsePfcTaxonomy(csvText)

  test("parses exactly 127 categories", () => {
    expect(categories).toHaveLength(127)
  })

  test("drops Plaid's prose note row", () => {
    const noteRow = categories.find((category) => category.detailed === "")
    expect(noteRow).toBeUndefined()
  })

  test("every detailed code is prefixed by its primary code", () => {
    for (const category of categories) {
      expect(category.detailed.startsWith(category.primary)).toBe(true)
    }
  })

  test("looks up curated display names", () => {
    const category = categories.find((entry) => entry.detailed === "FOOD_AND_DRINK_COFFEE")
    expect(category).toMatchObject({ name: "Coffee Shops", primaryName: "Food & Drink" })
  })

  test("maps the three unambiguous PFC v1 codes that drift from their v2 name", () => {
    // These three v1 codes appear as an alias on exactly one v2 row.
    const drifted: Record<string, string> = {
      INCOME_WAGES: "INCOME_SALARY",
      INCOME_OTHER_INCOME: "INCOME_OTHER",
      TRANSFER_IN_CASH_ADVANCES_AND_LOANS: "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT",
    }

    for (const [v1Code, v2Code] of Object.entries(drifted)) {
      const category = categories.find((entry) => entry.pfcv1Detailed.includes(v1Code))
      expect(category?.detailed).toBe(v2Code)
    }
  })

  test("OTHER_OTHER carries both of its v1 aliases", () => {
    const category = categories.find((entry) => entry.detailed === "OTHER_OTHER")
    expect(category?.pfcv1Detailed).toEqual([
      "TRANSFER_IN_OTHER_TRANSFER_IN",
      "TRANSFER_OUT_OTHER_TRANSFER_OUT",
    ])
  })

  test("TRANSFER_IN_OTHER_TRANSFER_IN and TRANSFER_OUT_OTHER_TRANSFER_OUT are ambiguous v1 codes", () => {
    // Plaid's CSV lists each of these as a v1 alias on TWO different v2 rows:
    // their own identically-named row (the trivial v1=v2 case) AND OTHER_OTHER's
    // alias list. A future v1 -> v2 lookup can't naively invert a flat map for
    // these two - that's a BUD-4 concern, not this ticket's, but the data shape
    // is worth asserting so it doesn't get "fixed" into a false uniqueness later.
    const ownRow = categories.find((entry) => entry.detailed === "TRANSFER_IN_OTHER_TRANSFER_IN")
    expect(ownRow?.pfcv1Detailed).toEqual(["TRANSFER_IN_OTHER_TRANSFER_IN"])

    const aliasedElsewhere = categories.filter((entry) =>
      entry.pfcv1Detailed.includes("TRANSFER_IN_OTHER_TRANSFER_IN"),
    )
    expect(aliasedElsewhere.map((entry) => entry.detailed).sort()).toEqual([
      "OTHER_OTHER",
      "TRANSFER_IN_OTHER_TRANSFER_IN",
    ])
  })

  test("a v2 code with no v1 counterpart has an empty alias list", () => {
    const category = categories.find((entry) => entry.detailed === "INCOME_CHILD_SUPPORT")
    expect(category?.pfcv1Detailed).toEqual([])
  })
})
