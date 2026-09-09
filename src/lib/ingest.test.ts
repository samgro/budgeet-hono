// Exercises lib/ingest.ts against a real (in-memory) Postgres via PGlite -
// see src/db/testing.ts. The first describe block is the actual deliverable
// of SDG-192: proof that a second sync run can never move an ai_ or ugc_
// column, enumerated from the schema rather than hand-listed so a column
// added next year is covered the day it lands.

import { beforeEach, describe, expect, test } from "bun:test"
import { eq, getTableColumns } from "drizzle-orm"
import { accounts, budgets, categories, subscriptions, transactions } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import { loadCategoryAliases, upsertAccounts, upsertTransactions } from "./ingest"
import type { TillerAccount, TillerTransaction } from "./tiller-map"

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>

let database: TestDatabase

beforeEach(async () => {
  database = await createTestDatabase()
})

function tillerAccount(id: string, overrides: Partial<TillerAccount> = {}): TillerAccount {
  return {
    id,
    rawName: `Account ${id}`,
    rawMask: "1234",
    rawInstitution: "Chase",
    rawType: "checking",
    rawClass: "asset",
    rawBalance: "100.00",
    rawBalanceAsOf: "2026-09-01",
    ...overrides,
  }
}

function tillerTransaction(
  id: string,
  accountId: string,
  overrides: Partial<TillerTransaction> = {},
): TillerTransaction {
  return {
    id,
    accountId,
    rawDate: "2026-08-01",
    rawAmount: "10.00",
    rawDescription: "Test transaction",
    rawFullDescription: null,
    rawMerchantName: null,
    rawCategoryPrimary: null,
    rawCategoryDetailed: null,
    rawCheckNumber: null,
    rawImportedAt: null,
    ...overrides,
  }
}

async function fetchTransaction(id: string) {
  const [row] = await database.select().from(transactions).where(eq(transactions.id, id))
  if (!row) throw new Error(`missing transaction: ${id}`)
  return row as unknown as Record<string, unknown>
}

describe("upsertTransactions - the raw-only invariant", () => {
  test("a second sync run refreshes every raw_ column and never moves an ai_ or ugc_ column", async () => {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    await database.insert(categories).values({
      detailed: "TEST_CATEGORY",
      name: "Test Category",
      primary: "TEST",
      primaryName: "Test",
    })
    await database
      .insert(budgets)
      .values({ id: "budget-1", name: "Budget", class: "discretionary" })
    await database
      .insert(subscriptions)
      .values({ id: "subscription-1", name: "Sub", merchantPattern: "test" })

    await upsertTransactions(database, [
      tillerTransaction("txn-1", "account-1", {
        rawDescription: "Original description",
        rawMerchantName: "Original Merchant",
      }),
    ])

    // Simulate /classify plus a hand edit - every single ai_/ugc_ column
    // gets a real, non-default value.
    await database
      .update(transactions)
      .set({
        aiBudgetId: "budget-1",
        aiSubscriptionId: "subscription-1",
        aiCategoryDetailed: "TEST_CATEGORY",
        aiConfidence: 0.9,
        aiModel: "claude-haiku-4-5-20251001",
        aiReasoning: "Looks like groceries",
        aiClassifiedAt: new Date("2026-08-02T00:00:00Z"),
        ugcAmount: "12.34",
        ugcDescription: "Corrected description",
        ugcCategoryDetailed: "TEST_CATEGORY",
        ugcBudgetId: "budget-1",
        ugcSubscriptionId: "subscription-1",
        ugcNote: "Personal note",
        ugcIsHidden: true,
      })
      .where(eq(transactions.id, "txn-1"))

    const beforeSecondRun = await fetchTransaction("txn-1")

    await upsertTransactions(database, [
      tillerTransaction("txn-1", "account-1", {
        rawDate: "2026-08-02",
        rawAmount: "99.99",
        rawDescription: "Updated description",
        rawFullDescription: "UPDATED DESCRIPTION",
        rawMerchantName: "Updated Merchant",
        rawCategoryPrimary: "TEST",
        rawCategoryDetailed: "TEST_CATEGORY",
        rawCheckNumber: "5678",
        rawImportedAt: "2026-08-02",
      }),
    ])

    const afterSecondRun = await fetchTransaction("txn-1")

    const columnNames = Object.keys(getTableColumns(transactions))
    const aiAndUgcColumns = columnNames.filter(
      (name) => name.startsWith("ai") || name.startsWith("ugc"),
    )
    const rawColumns = columnNames.filter((name) => name.startsWith("raw"))

    // The columns this test must protect - if this list is empty, the test
    // asserts nothing and passes for the wrong reason.
    expect(aiAndUgcColumns.length).toBeGreaterThan(0)
    expect(rawColumns.length).toBeGreaterThan(0)

    for (const name of aiAndUgcColumns) {
      expect(afterSecondRun[name]).toEqual(beforeSecondRun[name])
    }
    for (const name of rawColumns) {
      expect(afterSecondRun[name]).not.toEqual(beforeSecondRun[name])
    }

    expect(afterSecondRun.createdAt).toEqual(beforeSecondRun.createdAt)
    expect((afterSecondRun.updatedAt as Date).getTime()).toBeGreaterThan(
      (beforeSecondRun.updatedAt as Date).getTime(),
    )
    expect((afterSecondRun.lastSeenAt as Date).getTime()).toBeGreaterThan(
      (beforeSecondRun.lastSeenAt as Date).getTime(),
    )
  })
})

describe("upsertTransactions", () => {
  test("a second run over unchanged data is idempotent: 0 inserted, N updated", async () => {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    const rows = [tillerTransaction("txn-1", "account-1"), tillerTransaction("txn-2", "account-1")]

    const firstRun = await upsertTransactions(database, rows)
    expect(firstRun).toMatchObject({ inserted: 2, updated: 0 })

    const secondRun = await upsertTransactions(database, rows)
    expect(secondRun).toMatchObject({ inserted: 0, updated: 2 })
  })

  test("a row absent from a later run is never deleted", async () => {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    await upsertTransactions(database, [
      tillerTransaction("txn-1", "account-1"),
      tillerTransaction("txn-2", "account-1"),
    ])

    // Only txn-1 in this run, as if txn-2 had scrolled out of the sheet's window.
    await upsertTransactions(database, [tillerTransaction("txn-1", "account-1")])

    const rows = await database.select({ id: transactions.id }).from(transactions)
    expect(rows.map((row) => row.id).sort()).toEqual(["txn-1", "txn-2"])
  })

  test("an unknown categoryDetailed is stored and reported, not rejected", async () => {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    const result = await upsertTransactions(database, [
      tillerTransaction("txn-1", "account-1", { rawCategoryDetailed: "SOME_UNKNOWN_CODE" }),
    ])
    expect(result.inserted).toBe(1)

    const row = await fetchTransaction("txn-1")
    expect(row.rawCategoryDetailed).toBe("SOME_UNKNOWN_CODE")
  })

  test("a transaction referencing an unknown account is skipped and reported, not left to fail the batch", async () => {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })

    const result = await upsertTransactions(database, [
      tillerTransaction("txn-known", "account-1"),
      tillerTransaction("txn-orphan", "account-missing"),
    ])

    expect(result.inserted).toBe(1)
    expect(result.skippedUnknownAccounts).toEqual(["txn-orphan"])

    const rows = await database.select({ id: transactions.id }).from(transactions)
    expect(rows.map((row) => row.id)).toEqual(["txn-known"])
  })
})

describe("upsertAccounts", () => {
  test("inserts new accounts and returns the count upserted", async () => {
    const count = await upsertAccounts(database, [
      tillerAccount("account-1"),
      tillerAccount("account-2"),
    ])
    expect(count).toBe(2)

    const rows = await database.select({ id: accounts.id }).from(accounts)
    expect(rows).toHaveLength(2)
  })

  test("refreshes raw_ columns on conflict without touching a ugc_ column", async () => {
    await upsertAccounts(database, [tillerAccount("account-1")])
    await database
      .update(accounts)
      .set({ ugcName: "My Checking", ugcIsHidden: true })
      .where(eq(accounts.id, "account-1"))

    await upsertAccounts(database, [tillerAccount("account-1", { rawBalance: "999.99" })])

    const [row] = await database.select().from(accounts).where(eq(accounts.id, "account-1"))
    expect(row?.rawBalance).toBe("999.99")
    expect(row?.ugcName).toBe("My Checking")
    expect(row?.ugcIsHidden).toBe(true)
  })

  test("a blank rawBalanceAsOf maps to null, not a thrown error", async () => {
    await upsertAccounts(database, [tillerAccount("account-1", { rawBalanceAsOf: null })])
    const [row] = await database.select().from(accounts).where(eq(accounts.id, "account-1"))
    expect(row?.rawBalanceAsOf).toBeNull()
  })
})

describe("loadCategoryAliases", () => {
  test("builds knownDetailed from every category and v1ToV2 only from actual aliases", async () => {
    await database.insert(categories).values([
      {
        detailed: "INCOME_SALARY",
        name: "Salary",
        primary: "INCOME",
        primaryName: "Income",
        pfcv1Detailed: ["INCOME_WAGES"],
      },
      {
        detailed: "FOOD_AND_DRINK_GROCERIES",
        name: "Groceries",
        primary: "FOOD_AND_DRINK",
        primaryName: "Food & Drink",
        pfcv1Detailed: [],
      },
    ])

    const aliases = await loadCategoryAliases(database)

    expect(aliases.knownDetailed.get("INCOME_SALARY")).toBe("INCOME")
    expect(aliases.knownDetailed.get("FOOD_AND_DRINK_GROCERIES")).toBe("FOOD_AND_DRINK")
    expect(aliases.v1ToV2.get("INCOME_WAGES")).toBe("INCOME_SALARY")
    // No drift, so no explicit identity entry - resolveCategory's own
    // fallback covers this case; see the comment on CategoryAliases.
    expect(aliases.v1ToV2.has("FOOD_AND_DRINK_GROCERIES")).toBe(false)
  })

  test("OTHER_OTHER's two v1 aliases both resolve to it", async () => {
    await database.insert(categories).values({
      detailed: "OTHER_OTHER",
      name: "Other",
      primary: "OTHER",
      primaryName: "Other",
      pfcv1Detailed: ["TRANSFER_IN_OTHER_TRANSFER_IN", "TRANSFER_OUT_OTHER_TRANSFER_OUT"],
    })

    const aliases = await loadCategoryAliases(database)

    expect(aliases.v1ToV2.get("TRANSFER_IN_OTHER_TRANSFER_IN")).toBe("OTHER_OTHER")
    expect(aliases.v1ToV2.get("TRANSFER_OUT_OTHER_TRANSFER_OUT")).toBe("OTHER_OTHER")
  })
})
