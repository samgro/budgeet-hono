// Exercises the resolved_transactions view against a real (in-memory) Postgres
// via PGlite, applying the committed migration rather than the schema object -
// see src/db/testing.ts. This is the "view tests pass" item of SDG-172's DoD:
// it's the only place the ugc > ai > raw precedence rule is asserted.

import { beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  accounts,
  budgets,
  categories,
  resolvedTransactions,
  subscriptions,
  tags,
  transactions,
  transactionTags,
  trips,
} from "./schema"
import { createTestDatabase } from "./testing"

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()

  await database.insert(accounts).values({
    id: "account-1",
    rawName: "Checking",
    rawInstitution: "Chase",
    rawType: "checking",
    rawClass: "asset",
  })

  await database.insert(budgets).values([
    { id: "budget-ai", name: "AI Budget", class: "discretionary" },
    { id: "budget-ugc", name: "UGC Budget", class: "discretionary" },
  ])

  await database.insert(trips).values([
    { id: "trip-ai", name: "AI Trip", startDate: "2026-01-01", endDate: "2026-01-10" },
    { id: "trip-ugc", name: "UGC Trip", startDate: "2026-02-01", endDate: "2026-02-10" },
  ])

  await database.insert(subscriptions).values([
    { id: "subscription-ai", name: "AI Sub", merchantPattern: "netflix" },
    { id: "subscription-ugc", name: "UGC Sub", merchantPattern: "spotify" },
  ])

  await database.insert(categories).values([
    { detailed: "TEST_CATEGORY_RAW", primary: "TEST" },
    { detailed: "TEST_CATEGORY_AI", primary: "TEST" },
    { detailed: "TEST_CATEGORY_UGC", primary: "TEST" },
  ])

  await database.insert(tags).values([
    { id: "tag-ai", name: "ai-tag" },
    { id: "tag-ugc", name: "ugc-tag" },
  ])
})

function baseTransaction(id: string) {
  return {
    id,
    accountId: "account-1",
    rawDate: "2026-03-01",
    rawAmount: "10.00",
    rawDescription: "Raw description",
  }
}

async function resolvedRow(id: string) {
  const [row] = await database
    .select()
    .from(resolvedTransactions)
    .where(eq(resolvedTransactions.id, id))
  return row
}

describe("resolved_transactions", () => {
  test("amount: ugc wins over raw", async () => {
    await database
      .insert(transactions)
      .values({ ...baseTransaction("txn-amount-ugc"), rawAmount: "10.00", ugcAmount: "12.34" })
    const row = await resolvedRow("txn-amount-ugc")
    expect(row?.amount).toBe("12.34")
  })

  test("amount: raw when no ugc override", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-amount-raw") })
    const row = await resolvedRow("txn-amount-raw")
    expect(row?.amount).toBe("10.00")
  })

  test("description: ugc > raw_merchant_name > raw_description", async () => {
    await database.insert(transactions).values({
      ...baseTransaction("txn-description-merchant"),
      rawMerchantName: "Merchant",
    })
    const merchantRow = await resolvedRow("txn-description-merchant")
    expect(merchantRow?.description).toBe("Merchant")

    await database.insert(transactions).values({
      ...baseTransaction("txn-description-ugc"),
      rawMerchantName: "Merchant",
      ugcDescription: "My description",
    })
    const ugcRow = await resolvedRow("txn-description-ugc")
    expect(ugcRow?.description).toBe("My description")

    await database.insert(transactions).values({ ...baseTransaction("txn-description-raw") })
    const rawRow = await resolvedRow("txn-description-raw")
    expect(rawRow?.description).toBe("Raw description")
  })

  test("category_detailed: ugc > ai > raw", async () => {
    await database.insert(transactions).values({
      ...baseTransaction("txn-category-raw"),
      rawCategoryDetailed: "TEST_CATEGORY_RAW",
    })
    expect((await resolvedRow("txn-category-raw"))?.categoryDetailed).toBe("TEST_CATEGORY_RAW")

    await database.insert(transactions).values({
      ...baseTransaction("txn-category-ai"),
      rawCategoryDetailed: "TEST_CATEGORY_RAW",
      aiCategoryDetailed: "TEST_CATEGORY_AI",
    })
    expect((await resolvedRow("txn-category-ai"))?.categoryDetailed).toBe("TEST_CATEGORY_AI")

    await database.insert(transactions).values({
      ...baseTransaction("txn-category-ugc"),
      rawCategoryDetailed: "TEST_CATEGORY_RAW",
      aiCategoryDetailed: "TEST_CATEGORY_AI",
      ugcCategoryDetailed: "TEST_CATEGORY_UGC",
    })
    expect((await resolvedRow("txn-category-ugc"))?.categoryDetailed).toBe("TEST_CATEGORY_UGC")
  })

  test("budget_id, trip_id, subscription_id: ugc wins over ai", async () => {
    await database.insert(transactions).values({
      ...baseTransaction("txn-links-ai"),
      aiBudgetId: "budget-ai",
      aiTripId: "trip-ai",
      aiSubscriptionId: "subscription-ai",
    })
    const aiRow = await resolvedRow("txn-links-ai")
    expect(aiRow?.budgetId).toBe("budget-ai")
    expect(aiRow?.tripId).toBe("trip-ai")
    expect(aiRow?.subscriptionId).toBe("subscription-ai")

    await database.insert(transactions).values({
      ...baseTransaction("txn-links-ugc"),
      aiBudgetId: "budget-ai",
      aiTripId: "trip-ai",
      aiSubscriptionId: "subscription-ai",
      ugcBudgetId: "budget-ugc",
      ugcTripId: "trip-ugc",
      ugcSubscriptionId: "subscription-ugc",
    })
    const ugcRow = await resolvedRow("txn-links-ugc")
    expect(ugcRow?.budgetId).toBe("budget-ugc")
    expect(ugcRow?.tripId).toBe("trip-ugc")
    expect(ugcRow?.subscriptionId).toBe("subscription-ugc")
  })

  test("budget_id, trip_id, subscription_id: null when neither set", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-links-null") })
    const row = await resolvedRow("txn-links-null")
    expect(row?.budgetId).toBeNull()
    expect(row?.tripId).toBeNull()
    expect(row?.subscriptionId).toBeNull()
  })

  test("budget_is_confirmed reflects whether ugc_budget_id is set", async () => {
    await database
      .insert(transactions)
      .values({ ...baseTransaction("txn-confirmed-true"), ugcBudgetId: "budget-ugc" })
    expect((await resolvedRow("txn-confirmed-true"))?.budgetIsConfirmed).toBe(true)

    await database
      .insert(transactions)
      .values({ ...baseTransaction("txn-confirmed-false"), aiBudgetId: "budget-ai" })
    expect((await resolvedRow("txn-confirmed-false"))?.budgetIsConfirmed).toBe(false)
  })

  test("direction: outflow for positive raw_amount, inflow for negative", async () => {
    await database
      .insert(transactions)
      .values({ ...baseTransaction("txn-direction-outflow"), rawAmount: "42.00" })
    expect((await resolvedRow("txn-direction-outflow"))?.direction).toBe("outflow")

    await database
      .insert(transactions)
      .values({ ...baseTransaction("txn-direction-inflow"), rawAmount: "-42.00" })
    expect((await resolvedRow("txn-direction-inflow"))?.direction).toBe("inflow")
  })

  test("tags: aggregates with each row's source stamp", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-tags") })
    await database.insert(transactionTags).values([
      { transactionId: "txn-tags", tagId: "tag-ai", source: "ai", aiConfidence: 0.9 },
      { transactionId: "txn-tags", tagId: "tag-ugc", source: "ugc" },
    ])

    const row = await resolvedRow("txn-tags")
    expect(row?.tags).toHaveLength(2)
    expect(row?.tags?.map((tag) => tag.source).sort()).toEqual(["ai", "ugc"])
    expect(row?.tags?.map((tag) => tag.name).sort()).toEqual(["ai-tag", "ugc-tag"])
  })

  test("tags: empty array, not null, when a transaction has none", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-no-tags") })
    const row = await resolvedRow("txn-no-tags")
    expect(row?.tags).toEqual([])
  })
})
