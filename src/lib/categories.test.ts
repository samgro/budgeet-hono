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
      { detailed: "FOOD_A", primary: "FOOD", description: "a", iconUrl: "icon" },
      { detailed: "FOOD_B", primary: "FOOD", description: "b", iconUrl: "icon" },
      { detailed: "FOOD_C", primary: "FOOD", description: "c", iconUrl: "icon" },
    ]
    expect(groupByPrimary(rows)).toEqual([
      {
        primary: "FOOD",
        iconUrl: "icon",
        detailed: [
          { detailed: "FOOD_A", description: "a" },
          { detailed: "FOOD_B", description: "b" },
          { detailed: "FOOD_C", description: "c" },
        ],
      },
    ])
  })

  test("two primaries, input order preserved within each group", () => {
    const rows: CategoryRow[] = [
      { detailed: "FOOD_A", primary: "FOOD", description: null, iconUrl: "food-icon" },
      { detailed: "TRAVEL_A", primary: "TRAVEL", description: null, iconUrl: "travel-icon" },
      { detailed: "FOOD_B", primary: "FOOD", description: null, iconUrl: "food-icon" },
    ]
    const groups = groupByPrimary(rows)
    // Two groups, opened in the order the primary first appears - a group
    // does not merge with a same-primary run that starts again later.
    expect(groups.map((group) => group.primary)).toEqual(["FOOD", "TRAVEL", "FOOD"])
    expect(groups[0]?.detailed.map((leaf) => leaf.detailed)).toEqual(["FOOD_A"])
  })

  test("group iconUrl picks up the first non-null value in the group", () => {
    const rows: CategoryRow[] = [
      { detailed: "FOOD_A", primary: "FOOD", description: null, iconUrl: null },
      { detailed: "FOOD_B", primary: "FOOD", description: null, iconUrl: "food-icon" },
    ]
    expect(groupByPrimary(rows)[0]?.iconUrl).toBe("food-icon")
  })

  test("group iconUrl is null when every row in the group is null", () => {
    const rows: CategoryRow[] = [
      { detailed: "FOOD_A", primary: "FOOD", description: null, iconUrl: null },
      { detailed: "FOOD_B", primary: "FOOD", description: null, iconUrl: null },
    ]
    expect(groupByPrimary(rows)[0]?.iconUrl).toBeNull()
  })

  test("a null description passes through unchanged", () => {
    const rows: CategoryRow[] = [
      { detailed: "OTHER_OTHER", primary: "OTHER", description: null, iconUrl: "other-icon" },
    ]
    expect(groupByPrimary(rows)[0]?.detailed[0]?.description).toBeNull()
  })
})

describe("listCategories", () => {
  test("empty table → { categories: [] }", async () => {
    const database = await createTestDatabase()
    expect(await listCategories(database)).toEqual({ categories: [] })
  })

  test("groups ordered by primary, leaves ordered by detailed, no pfcv1Detailed", async () => {
    const database = await createTestDatabase()

    // Inserted scrambled - neither primary-grouped nor detailed-sorted - so a
    // missing orderBy would fail this rather than accidentally pass.
    await database.insert(categories).values([
      {
        detailed: "TRAVEL_FLIGHTS",
        primary: "TRAVEL",
        description: "Flights",
        iconUrl: "travel-icon",
      },
      {
        detailed: "FOOD_AND_DRINK_GROCERIES",
        primary: "FOOD_AND_DRINK",
        description: "Grocery stores",
        iconUrl: "food-icon",
        pfcv1Detailed: ["FOOD_AND_DRINK_GROCERIES"],
      },
      {
        detailed: "OTHER_OTHER",
        primary: "OTHER",
        description: null,
        iconUrl: "other-icon",
      },
      {
        detailed: "FOOD_AND_DRINK_COFFEE",
        primary: "FOOD_AND_DRINK",
        description: "Coffee shops",
        iconUrl: "food-icon",
      },
      {
        detailed: "TRAVEL_LODGING",
        primary: "TRAVEL",
        description: "Lodging",
        iconUrl: "travel-icon",
      },
    ])

    const { categories: groups } = await listCategories(database)

    expect(groups.map((group) => group.primary)).toEqual(["FOOD_AND_DRINK", "OTHER", "TRAVEL"])
    expect(groups.find((group) => group.primary === "FOOD_AND_DRINK")?.detailed).toEqual([
      { detailed: "FOOD_AND_DRINK_COFFEE", description: "Coffee shops" },
      { detailed: "FOOD_AND_DRINK_GROCERIES", description: "Grocery stores" },
    ])
    expect(groups.find((group) => group.primary === "TRAVEL")?.iconUrl).toBe("travel-icon")
    expect(groups.find((group) => group.primary === "OTHER")?.detailed).toEqual([
      { detailed: "OTHER_OTHER", description: null },
    ])

    // pfcv1Detailed is the sync-side v1->v2 mapping, not display data - it
    // must never leak into the response.
    expect(JSON.stringify(groups)).not.toContain("pfcv1")
  })
})
