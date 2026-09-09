// Exercises lib/transactions.ts. parseTransactionQuery is pure; listTransactions
// and getTransaction go through PGlite (src/db/testing.ts), same harness as
// src/db/resolved-transactions.test.ts.

import { beforeAll, describe, expect, test } from "bun:test"
import {
  accounts,
  budgets,
  categories,
  corrections,
  subscriptions,
  tags,
  transactions,
  transactionTags,
} from "../db/schema"
import { createTestDatabase } from "../db/testing"
import { type Cursor, decodeCursor, encodeCursor, InvalidCursorError } from "./cursor"
import {
  getTransaction,
  InvalidTransactionQueryError,
  listTransactions,
  parseTransactionQuery,
  toCategoryDisplay,
} from "./transactions"

describe("toCategoryDisplay", () => {
  test("both levels populated → nested primary and detailed", () => {
    expect(
      toCategoryDisplay({
        categoryPrimaryId: "FOOD_AND_DRINK",
        categoryPrimaryName: "Food & Drink",
        categoryDetailedId: "FOOD_AND_DRINK_COFFEE",
        categoryDetailedName: "Coffee Shops",
      }),
    ).toEqual({
      primary: { id: "FOOD_AND_DRINK", name: "Food & Drink" },
      detailed: { id: "FOOD_AND_DRINK_COFFEE", name: "Coffee Shops" },
    })
  })

  // The leftJoin miss case: an unclassified transaction, or a
  // raw_category_detailed the taxonomy doesn't know about (CLAUDE.md's no-FK
  // gotcha). Drizzle's nested-object select() only supports one level of
  // nesting, so the four columns are selected flat and reassembled here -
  // this is what makes a miss collapse to null instead of shipping
  // { primary: { id: null, ... }, detailed: { id: null, ... } }.
  test("every column null (leftJoin miss) → null, not an object of nulls", () => {
    expect(
      toCategoryDisplay({
        categoryPrimaryId: null,
        categoryPrimaryName: null,
        categoryDetailedId: null,
        categoryDetailedName: null,
      }),
    ).toBeNull()
  })
})

describe("parseTransactionQuery", () => {
  test("no params → defaults, every filter undefined", () => {
    expect(parseTransactionQuery({})).toEqual({
      from: undefined,
      to: undefined,
      accountId: undefined,
      budgetId: undefined,
      tagId: undefined,
      subscriptionId: undefined,
      unassigned: undefined,
      searchPattern: undefined,
      includeHidden: false,
      limit: 50,
      cursor: undefined,
    })
  })

  test("limit=200 passes through unchanged", () => {
    expect(parseTransactionQuery({ limit: "200" }).limit).toBe(200)
  })

  test("limit=201 clamps to 200", () => {
    expect(parseTransactionQuery({ limit: "201" }).limit).toBe(200)
  })

  for (const badLimit of ["0", "-1", "abc", "1e3", "50.5", " 50"]) {
    test(`limit=${badLimit} throws`, () => {
      expect(() => parseTransactionQuery({ limit: badLimit })).toThrow(InvalidTransactionQueryError)
    })
  }

  test("from=2026-13-01 throws", () => {
    expect(() => parseTransactionQuery({ from: "2026-13-01" })).toThrow(
      InvalidTransactionQueryError,
    )
  })

  test("to=2026-03-01 passes through", () => {
    expect(parseTransactionQuery({ to: "2026-03-01" }).to).toBe("2026-03-01")
  })

  test("unassigned=true / false parse to booleans", () => {
    expect(parseTransactionQuery({ unassigned: "true" }).unassigned).toBe(true)
    expect(parseTransactionQuery({ unassigned: "false" }).unassigned).toBe(false)
  })

  test("unassigned=yes throws", () => {
    expect(() => parseTransactionQuery({ unassigned: "yes" })).toThrow(InvalidTransactionQueryError)
  })

  test("includeHidden=true parses to true", () => {
    expect(parseTransactionQuery({ includeHidden: "true" }).includeHidden).toBe(true)
  })

  test("id filters are trimmed, empty string → undefined", () => {
    expect(parseTransactionQuery({ accountId: "  acct-1  " }).accountId).toBe("acct-1")
    expect(parseTransactionQuery({ accountId: "   " }).accountId).toBeUndefined()
  })

  test('q="  coffee  " → "%coffee%"', () => {
    expect(parseTransactionQuery({ q: "  coffee  " }).searchPattern).toBe("%coffee%")
  })

  test("q of only whitespace → undefined", () => {
    expect(parseTransactionQuery({ q: "   " }).searchPattern).toBeUndefined()
  })

  test('q="50%" escapes the wildcard', () => {
    expect(parseTransactionQuery({ q: "50%" }).searchPattern).toBe("%50\\%%")
  })

  test('q="a_b" escapes the underscore wildcard', () => {
    expect(parseTransactionQuery({ q: "a_b" }).searchPattern).toBe("%a\\_b%")
  })

  test("cursor=garbage throws InvalidCursorError", () => {
    expect(() => parseTransactionQuery({ cursor: "garbage" })).toThrow(InvalidCursorError)
  })

  test("a valid cursor decodes", () => {
    const token = encodeCursor({ date: "2026-03-01", id: "txn-1" })
    expect(parseTransactionQuery({ cursor: token }).cursor).toEqual({
      date: "2026-03-01",
      id: "txn-1",
    })
  })
})

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()

  await database.insert(accounts).values([
    {
      id: "account-visible",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    },
    {
      id: "account-nicknamed",
      rawName: "Ultimate Rewards",
      ugcName: "Sapphire",
      rawInstitution: "Chase",
      rawType: "credit",
      rawClass: "liability",
    },
    {
      id: "account-hidden",
      rawName: "Old Savings",
      rawInstitution: "Ally",
      rawType: "savings",
      rawClass: "asset",
      ugcIsHidden: true,
    },
  ])

  await database.insert(budgets).values([
    { id: "budget-ai", name: "AI Budget", class: "discretionary" },
    { id: "budget-ugc", name: "UGC Budget", class: "discretionary", color: "#e0b341", emoji: "🍜" },
  ])

  await database.insert(subscriptions).values([
    { id: "subscription-ai", name: "AI Sub", merchantPattern: "netflix" },
    { id: "subscription-ugc", name: "UGC Sub", merchantPattern: "spotify" },
  ])

  await database.insert(categories).values([
    {
      detailed: "FOOD_AND_DRINK_COFFEE",
      name: "Coffee Shops",
      primary: "FOOD_AND_DRINK",
      primaryName: "Food & Drink",
    },
  ])

  await database.insert(tags).values([
    { id: "tag-food", name: "food", color: "#8b5cf6", emoji: "🐈" },
    {
      id: "trip-root",
      name: "AU/NZ",
      kind: "trip",
      startDate: "2026-01-01",
      endDate: "2026-01-10",
    },
    { id: "biz-root", name: "DPHQ", kind: "business" },
  ])
  await database
    .insert(tags)
    .values([{ id: "biz-child", parentId: "biz-root", name: "Advertising", kind: "business" }])
})

// transactions.id is NOT NULL at the DB level; the view types it nullable
// only because a Postgres view carries no NOT NULL constraints for
// drizzle-kit to record. Narrow once here, same reasoning as production's
// toCursor in lib/transactions.ts.
function transactionId(row: { id: string | null }): string {
  if (row.id === null) throw new Error("expected a non-null id")
  return row.id
}

function searchPattern(term: string) {
  return parseTransactionQuery({ q: term }).searchPattern
}

function baseTransaction(id: string, overrides: Partial<typeof transactions.$inferInsert> = {}) {
  return {
    id,
    accountId: "account-visible",
    rawDate: "2026-03-01",
    rawAmount: "10.00",
    rawDescription: "Raw description",
    ...overrides,
  }
}

describe("listTransactions / getTransaction", () => {
  test("account.name uses ugc_name when set, falls back to 'institution rawName' otherwise", async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-nick", { accountId: "account-nicknamed" }))
    const page = await listTransactions(database, baseQuery({ accountId: "account-nicknamed" }))
    expect(page.transactions[0]?.account.name).toBe("Sapphire")

    await database.insert(transactions).values(baseTransaction("txn-nonick"))
    const plainPage = await listTransactions(database, baseQuery({ accountId: "account-visible" }))
    expect(plainPage.transactions.find((row) => row.id === "txn-nonick")?.account.name).toBe(
      "Chase Checking",
    )
  })

  test("budget carries color and emoji; unclassified rows get budget: null", async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-budget-ugc", { ugcBudgetId: "budget-ugc" }))
    const page = await listTransactions(database, baseQuery({ budgetId: "budget-ugc" }))
    expect(page.transactions[0]?.budget).toEqual({
      id: "budget-ugc",
      name: "UGC Budget",
      class: "discretionary",
      color: "#e0b341",
      emoji: "🍜",
    })

    await database.insert(transactions).values(baseTransaction("txn-unclassified"))
    const detail = await getTransaction(database, "txn-unclassified")
    expect(detail?.budget).toBeNull()
    expect(detail?.subscription).toBeNull()
  })

  test("category is null for a raw code absent from the seed, row still returned", async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-unseeded-category", { rawCategoryDetailed: "SOME_FUTURE_CODE" }))
    const detail = await getTransaction(database, "txn-unseeded-category")
    expect(detail).not.toBeNull()
    expect(detail?.category).toBeNull()
  })

  test("category comes through for a seeded code", async () => {
    await database
      .insert(transactions)
      .values(
        baseTransaction("txn-seeded-category", { rawCategoryDetailed: "FOOD_AND_DRINK_COFFEE" }),
      )
    const detail = await getTransaction(database, "txn-seeded-category")
    expect(detail?.category).toEqual({
      primary: { id: "FOOD_AND_DRINK", name: "Food & Drink" },
      detailed: { id: "FOOD_AND_DRINK_COFFEE", name: "Coffee Shops" },
    })
  })

  test("tags carry color, emoji, and path", async () => {
    await database.insert(transactions).values(baseTransaction("txn-tag-display"))
    await database
      .insert(transactionTags)
      .values({ transactionId: "txn-tag-display", tagId: "tag-food", kind: "label", source: "ugc" })
    const detail = await getTransaction(database, "txn-tag-display")
    expect(detail?.tags).toEqual([
      {
        id: "tag-food",
        name: "food",
        parentId: null,
        kind: "label",
        color: "#8b5cf6",
        emoji: "🐈",
        path: "food",
        source: "ugc",
      },
    ])
  })

  test("hidden transaction excluded by default, included with includeHidden", async () => {
    await database.insert(transactions).values(baseTransaction("txn-hidden", { ugcIsHidden: true }))
    const defaultPage = await listTransactions(
      database,
      baseQuery({ accountId: "account-visible" }),
    )
    expect(defaultPage.transactions.some((row) => row.id === "txn-hidden")).toBe(false)

    const includedPage = await listTransactions(
      database,
      baseQuery({ accountId: "account-visible", includeHidden: true }),
    )
    expect(includedPage.transactions.some((row) => row.id === "txn-hidden")).toBe(true)
  })

  test("transaction on a hidden account excluded by default, included with includeHidden", async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-on-hidden-account", { accountId: "account-hidden" }))
    const defaultPage = await listTransactions(database, baseQuery({ accountId: "account-hidden" }))
    expect(defaultPage.transactions).toEqual([])

    const includedPage = await listTransactions(
      database,
      baseQuery({ accountId: "account-hidden", includeHidden: true }),
    )
    expect(includedPage.transactions.some((row) => row.id === "txn-on-hidden-account")).toBe(true)
  })

  test("getTransaction returns a hidden row and a row on a hidden account", async () => {
    expect(await getTransaction(database, "txn-hidden")).not.toBeNull()
    expect(await getTransaction(database, "txn-on-hidden-account")).not.toBeNull()
  })

  test("getTransaction(unknown id) → null", async () => {
    expect(await getTransaction(database, "no-such-transaction")).toBeNull()
  })

  test("from/to are inclusive on both boundaries", async () => {
    await database
      .insert(transactions)
      .values([
        baseTransaction("txn-range-before", { rawDate: "2026-04-30" }),
        baseTransaction("txn-range-start", { rawDate: "2026-05-01" }),
        baseTransaction("txn-range-end", { rawDate: "2026-05-31" }),
        baseTransaction("txn-range-after", { rawDate: "2026-06-01" }),
      ])
    const page = await listTransactions(
      database,
      baseQuery({ accountId: "account-visible", from: "2026-05-01", to: "2026-05-31" }),
    )
    const ids = page.transactions.map((row) => row.id).sort()
    expect(ids).toEqual(["txn-range-end", "txn-range-start"])
  })

  test("budgetId precedence: filters on coalesce(ugc, ai), not either source alone", async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-precedence-ai-only", { aiBudgetId: "budget-ai" }))
    await database
      .insert(transactions)
      .values(baseTransaction("txn-precedence-ugc-only", { ugcBudgetId: "budget-ai" }))
    await database.insert(transactions).values(
      baseTransaction("txn-precedence-both", {
        aiBudgetId: "budget-ai",
        ugcBudgetId: "budget-ugc",
      }),
    )

    const matchesAi = await listTransactions(database, baseQuery({ budgetId: "budget-ai" }))
    const matchedIds = matchesAi.transactions.map((row) => row.id)
    expect(matchedIds).toContain("txn-precedence-ai-only")
    expect(matchedIds).toContain("txn-precedence-ugc-only")
    // ugc (budget-ugc) beats ai (budget-ai) on this row - it must not match budgetId=budget-ai.
    expect(matchedIds).not.toContain("txn-precedence-both")

    const matchesUgc = await listTransactions(database, baseQuery({ budgetId: "budget-ugc" }))
    expect(matchesUgc.transactions.map((row) => row.id)).toContain("txn-precedence-both")
  })

  test("unassigned=true matches only null-budget rows, not the system-budget style case", async () => {
    await database.insert(transactions).values(baseTransaction("txn-truly-unassigned"))
    await database
      .insert(transactions)
      .values(baseTransaction("txn-assigned", { ugcBudgetId: "budget-ugc" }))

    const page = await listTransactions(database, baseQuery({ unassigned: true }))
    const ids = page.transactions.map((row) => row.id)
    expect(ids).toContain("txn-truly-unassigned")
    expect(ids).not.toContain("txn-assigned")
  })

  test("tagId on a business root matches rows tagged with its child", async () => {
    await database.insert(transactions).values(baseTransaction("txn-biz-child"))
    await database.insert(transactionTags).values({
      transactionId: "txn-biz-child",
      tagId: "biz-child",
      kind: "business",
      source: "ai",
    })
    const rootPage = await listTransactions(database, baseQuery({ tagId: "biz-root" }))
    expect(rootPage.transactions.map((row) => row.id)).toContain("txn-biz-child")

    const childPage = await listTransactions(database, baseQuery({ tagId: "biz-child" }))
    expect(childPage.transactions.map((row) => row.id)).toContain("txn-biz-child")
  })

  test("tagId on a trip tag filters like any other tag", async () => {
    await database.insert(transactions).values(baseTransaction("txn-trip"))
    await database.insert(transactionTags).values({
      transactionId: "txn-trip",
      tagId: "trip-root",
      kind: "trip",
      source: "ugc",
    })
    const page = await listTransactions(database, baseQuery({ tagId: "trip-root" }))
    expect(page.transactions.map((row) => row.id)).toContain("txn-trip")
  })

  test("a rejected tag assignment never matches tagId", async () => {
    await database.insert(transactions).values(baseTransaction("txn-tag-rejected"))
    await database.insert(transactionTags).values({
      transactionId: "txn-tag-rejected",
      tagId: "tag-food",
      kind: "label",
      source: "ugc",
      isRejected: true,
    })
    const page = await listTransactions(database, baseQuery({ tagId: "tag-food" }))
    expect(page.transactions.map((row) => row.id)).not.toContain("txn-tag-rejected")
  })

  test("q matches merchant, description, and note, case-insensitively", async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-q-merchant", { rawMerchantName: "Blue Bottle Coffee" }))
    await database
      .insert(transactions)
      .values(baseTransaction("txn-q-description", { rawDescription: "SQ *BLUE BOTTLE" }))
    await database
      .insert(transactions)
      .values(baseTransaction("txn-q-note", { ugcNote: "wedding gift" }))

    expect(
      (
        await listTransactions(database, baseQuery({ searchPattern: searchPattern("blue bottle") }))
      ).transactions.map(transactionId),
    ).toEqual(expect.arrayContaining(["txn-q-merchant", "txn-q-description"]))

    expect(
      (
        await listTransactions(database, baseQuery({ searchPattern: searchPattern("WEDDING") }))
      ).transactions.map(transactionId),
    ).toContain("txn-q-note")
  })

  test('q="100%" does not match "1000 dollars" (the escaping proof)', async () => {
    await database
      .insert(transactions)
      .values(baseTransaction("txn-q-escape", { rawMerchantName: "1000 dollars" }))
    const page = await listTransactions(
      database,
      baseQuery({ searchPattern: searchPattern("100%") }),
    )
    expect(page.transactions.map(transactionId)).not.toContain("txn-q-escape")
  })

  test("ordering is date desc, id desc", async () => {
    await database
      .insert(transactions)
      .values([
        baseTransaction("txn-order-a", { rawDate: "2026-07-01" }),
        baseTransaction("txn-order-b", { rawDate: "2026-07-02" }),
        baseTransaction("txn-order-c", { rawDate: "2026-07-02" }),
      ])
    const page = await listTransactions(
      database,
      baseQuery({ accountId: "account-visible", from: "2026-07-01", to: "2026-07-02" }),
    )
    const ordered = page.transactions.map(transactionId).filter((id) => id.startsWith("txn-order-"))
    expect(ordered).toEqual(["txn-order-c", "txn-order-b", "txn-order-a"])
  })

  test("getTransaction returns corrections newest-first", async () => {
    await database.insert(transactions).values(baseTransaction("txn-corrections"))
    const sharedTimestamp = new Date("2026-03-02T18:00:00Z")
    await database.insert(corrections).values([
      {
        id: "corr-a",
        transactionId: "txn-corrections",
        field: "budget",
        fromValue: "budget-misc",
        toValue: "budget-food",
        createdAt: sharedTimestamp,
      },
      {
        id: "corr-b",
        transactionId: "txn-corrections",
        field: "category",
        fromValue: "OLD_CODE",
        toValue: "NEW_CODE",
        createdAt: sharedTimestamp,
      },
    ])
    const detail = await getTransaction(database, "txn-corrections")
    expect(detail?.corrections.map((correction) => correction.id)).toEqual(["corr-b", "corr-a"])
  })

  test("exact-multiple set emits one page and nextCursor: null", async () => {
    const database = await createTestDatabase()
    await database.insert(accounts).values({
      id: "acct",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    await database
      .insert(transactions)
      .values([
        baseTransaction("m-1", { accountId: "acct", rawDate: "2026-01-01" }),
        baseTransaction("m-2", { accountId: "acct", rawDate: "2026-01-02" }),
        baseTransaction("m-3", { accountId: "acct", rawDate: "2026-01-03" }),
        baseTransaction("m-4", { accountId: "acct", rawDate: "2026-01-04" }),
      ])
    const page = await listTransactions(database, baseQuery({ limit: 4 }))
    expect(page.transactions).toHaveLength(4)
    expect(page.nextCursor).toBeNull()
  })

  test("cursor walks the full set with no gaps and no repeats", async () => {
    const database = await createTestDatabase()
    await database.insert(accounts).values({
      id: "acct",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    await database.insert(budgets).values({ id: "b1", name: "B1", class: "discretionary" })

    // Deliberately uneven, non-multiple group sizes across dates - 5/1/7/4 -
    // so a limit of 3 forces a page boundary inside a same-date run, which is
    // what exercises the id-desc tiebreak. Ids are chosen so their lexical
    // order differs from insertion order, so a walk that accidentally relies
    // on physical row order would fail.
    const dateCounts: [string, number][] = [
      ["2026-03-01", 5],
      ["2026-03-02", 1],
      ["2026-03-03", 7],
      ["2026-03-04", 4],
    ]
    const rows = []
    let counter = 0
    for (const [rawDate, count] of dateCounts) {
      for (let index = 0; index < count; index++) {
        const letter = String.fromCharCode(122 - (counter % 26)) // z, y, x, ...
        rows.push(
          baseTransaction(`txn-${letter}-${counter}`, {
            accountId: "acct",
            rawDate,
            ugcBudgetId: counter % 3 === 0 ? "b1" : undefined,
          }),
        )
        counter++
      }
    }
    await database.insert(transactions).values(rows)

    const expected = await listTransactions(database, baseQuery({ limit: 200 }))
    expect(expected.transactions).toHaveLength(17)

    const walked: string[] = []
    let cursor: Cursor | undefined
    let pages = 0
    while (pages < 50) {
      const page = await listTransactions(database, baseQuery({ limit: 3, cursor }))
      walked.push(...page.transactions.map(transactionId))
      pages++
      if (!page.nextCursor) break
      cursor = decodeCursor(page.nextCursor)
    }

    expect(new Set(walked).size).toBe(walked.length)
    expect(walked).toEqual(expected.transactions.map(transactionId))
    expect(pages).toBe(6) // ceil(17 / 3)

    // A filter survives the walk - filter-plus-cursor is where keyset
    // pagination usually breaks, because the filter has to be reapplied on
    // every page.
    const expectedFiltered = await listTransactions(
      database,
      baseQuery({ limit: 200, budgetId: "b1" }),
    )
    const walkedFiltered: string[] = []
    let filteredCursor: Cursor | undefined
    let filteredPages = 0
    while (filteredPages < 50) {
      const page = await listTransactions(
        database,
        baseQuery({ limit: 2, budgetId: "b1", cursor: filteredCursor }),
      )
      walkedFiltered.push(...page.transactions.map(transactionId))
      filteredPages++
      if (!page.nextCursor) break
      filteredCursor = decodeCursor(page.nextCursor)
    }
    expect(walkedFiltered).toEqual(expectedFiltered.transactions.map(transactionId))
  })
})

function baseQuery(overrides: Partial<Parameters<typeof listTransactions>[1]> = {}) {
  return {
    includeHidden: false,
    limit: 50,
    ...overrides,
  }
}
