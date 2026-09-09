// Guards the one thing that makes a hand-written map safe: exact key-set
// parity against the taxonomy this repo actually ships, in both directions.
// A taxonomy refresh that adds a code fails here, loudly, instead of shipping
// a blank name; a stale label left behind after a code is retired fails here
// too, instead of quietly rotting.

import { describe, expect, test } from "bun:test"
import { DETAILED_NAMES, PRIMARY_NAMES } from "./category-names"
import { parsePfcTaxonomy } from "./pfc"

const csvPath = new URL("../db/seeds/pfc-taxonomy-all.csv", import.meta.url)
const csvText = await Bun.file(csvPath).text()
const taxonomy = parsePfcTaxonomy(csvText)

describe("category-names parity with the committed taxonomy", () => {
  test("every detailed code in the CSV has a curated name", () => {
    const missing = taxonomy
      .map((category) => category.detailed)
      .filter((detailed) => !(detailed in DETAILED_NAMES))
    expect(missing).toEqual([])
  })

  test("every curated detailed name maps to a code the CSV still carries", () => {
    const csvDetailed = new Set(taxonomy.map((category) => category.detailed))
    const orphaned = Object.keys(DETAILED_NAMES).filter((detailed) => !csvDetailed.has(detailed))
    expect(orphaned).toEqual([])
  })

  test("every primary code in the CSV has a curated name", () => {
    const csvPrimaries = new Set(taxonomy.map((category) => category.primary))
    const missing = [...csvPrimaries].filter((primary) => !(primary in PRIMARY_NAMES))
    expect(missing).toEqual([])
  })

  test("every curated primary name maps to a code the CSV still carries", () => {
    const csvPrimaries = new Set(taxonomy.map((category) => category.primary))
    const orphaned = Object.keys(PRIMARY_NAMES).filter((primary) => !csvPrimaries.has(primary))
    expect(orphaned).toEqual([])
  })

  test("exactly 127 detailed names and 18 primary names", () => {
    expect(Object.keys(DETAILED_NAMES)).toHaveLength(127)
    expect(Object.keys(PRIMARY_NAMES)).toHaveLength(18)
  })
})
