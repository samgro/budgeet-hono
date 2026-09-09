// Exercises lib/categories.ts. groupByPrimary is pure; listCategories goes
// through PGlite (src/db/testing.ts).

import { describe, expect, test } from "bun:test"
import { categories } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import { type CategoryRow, groupByPrimary, listCategories } from "./categories"

describe("groupByPrimary", () => {
  test("empty input → empty output", () => {
    expect(groupByPrimary([])).toEqual([])
  })

  test("one primary with three leaves → one group with three", () => {
    const rows: CategoryRow[] = [
      { detailed: "FOOD_A", name: "A", primary: "FOOD", primaryName: "Food" },
      { detailed: "FOOD_B", name: "B", primary: "FOOD", primaryName: "Food" },
      { detailed: "FOOD_C", name: "C", primary: "FOOD", primaryName: "Food" },
    ]
    expect(groupByPrimary(rows)).toEqual([
      {
        primary: { id: "FOOD", name: "Food" },
        detailed: [
          { id: "FOOD_A", name: "A" },
          { id: "FOOD_B", name: "B" },
          { id: "FOOD_C", name: "C" },
        ],
      },
    ])
  })

  test("two primaries, input order preserved within each group", () => {
    const rows: CategoryRow[] = [
      { detailed: "FOOD_A", name: "A", primary: "FOOD", primaryName: "Food" },
      { detailed: "TRAVEL_A", name: "A", primary: "TRAVEL", primaryName: "Travel" },
      { detailed: "FOOD_B", name: "B", primary: "FOOD", primaryName: "Food" },
    ]
    const groups = groupByPrimary(rows)
    // Two groups, opened in the order the primary first appears - a group
    // does not merge with a same-primary run that starts again later.
    expect(groups.map((group) => group.primary.id)).toEqual(["FOOD", "TRAVEL", "FOOD"])
    expect(groups[0]?.detailed.map((leaf) => leaf.id)).toEqual(["FOOD_A"])
  })
})

describe("listCategories", () => {
  test("empty table → { categories: [] }", async () => {
    const database = await createTestDatabase()
    expect(await listCategories(database)).toEqual({ categories: [] })
  })

  test("groups ordered by primary, leaves ordered by detailed", async () => {
    const database = await createTestDatabase()

    // Inserted scrambled - neither primary-grouped nor detailed-sorted - so a
    // missing orderBy would fail this rather than accidentally pass.
    await database.insert(categories).values([
      {
        detailed: "TRAVEL_FLIGHTS",
        name: "Flights",
        primary: "TRAVEL",
        primaryName: "Travel",
      },
      {
        detailed: "FOOD_AND_DRINK_GROCERIES",
        name: "Groceries",
        primary: "FOOD_AND_DRINK",
        primaryName: "Food & Drink",
        pfcv1Detailed: ["FOOD_AND_DRINK_GROCERIES"],
      },
      {
        detailed: "OTHER_OTHER",
        name: "Other",
        primary: "OTHER",
        primaryName: "Other",
      },
      {
        detailed: "FOOD_AND_DRINK_COFFEE",
        name: "Coffee Shops",
        primary: "FOOD_AND_DRINK",
        primaryName: "Food & Drink",
      },
      {
        detailed: "TRAVEL_LODGING",
        name: "Lodging",
        primary: "TRAVEL",
        primaryName: "Travel",
      },
    ])

    const { categories: groups } = await listCategories(database)

    expect(groups.map((group) => group.primary.id)).toEqual(["FOOD_AND_DRINK", "OTHER", "TRAVEL"])
    expect(groups.find((group) => group.primary.id === "FOOD_AND_DRINK")?.detailed).toEqual([
      { id: "FOOD_AND_DRINK_COFFEE", name: "Coffee Shops" },
      { id: "FOOD_AND_DRINK_GROCERIES", name: "Groceries" },
    ])
    expect(groups.find((group) => group.primary.id === "TRAVEL")?.primary).toEqual({
      id: "TRAVEL",
      name: "Travel",
    })
    expect(groups.find((group) => group.primary.id === "OTHER")?.detailed).toEqual([
      { id: "OTHER_OTHER", name: "Other" },
    ])

    // pfcv1Detailed is the sync-side v1->v2 mapping, not display data - it
    // must never leak into the response.
    expect(JSON.stringify(groups)).not.toContain("pfcv1")
  })
})
