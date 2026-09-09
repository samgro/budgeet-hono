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

  await database.insert(subscriptions).values([
    { id: "subscription-ai", name: "AI Sub", merchantPattern: "netflix" },
    { id: "subscription-ugc", name: "UGC Sub", merchantPattern: "spotify" },
  ])

  await database.insert(categories).values([
    { detailed: "TEST_CATEGORY_RAW", name: "Raw", primary: "TEST", primaryName: "Test" },
    { detailed: "TEST_CATEGORY_AI", name: "AI", primary: "TEST", primaryName: "Test" },
    { detailed: "TEST_CATEGORY_UGC", name: "UGC", primary: "TEST", primaryName: "Test" },
  ])

  await database.insert(tags).values([
    { id: "tag-ai", name: "ai-tag" },
    { id: "tag-ugc", name: "ugc-tag", color: "#8b5cf6", emoji: "🐈" },
    { id: "cat", name: "cat", kind: "label" },
    {
      id: "trip-ai",
      name: "AI Trip",
      kind: "trip",
      startDate: "2026-01-01",
      endDate: "2026-01-10",
    },
    {
      id: "trip-ugc",
      name: "UGC Trip",
      kind: "trip",
      startDate: "2026-02-01",
      endDate: "2026-02-10",
    },
    { id: "biz-root", name: "DPHQ", kind: "business" },
  ])
  await database
    .insert(tags)
    .values([{ id: "cat-food", parentId: "cat", name: "food", kind: "label" }])
  await database
    .insert(tags)
    .values([{ id: "biz-child", parentId: "biz-root", name: "Advertising", kind: "business" }])
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
      aiSubscriptionId: "subscription-ai",
    })
    await database
      .insert(transactionTags)
      .values({ transactionId: "txn-links-ai", tagId: "trip-ai", kind: "trip", source: "ai" })
    const aiRow = await resolvedRow("txn-links-ai")
    expect(aiRow?.budgetId).toBe("budget-ai")
    expect(aiRow?.tripId).toBe("trip-ai")
    expect(aiRow?.subscriptionId).toBe("subscription-ai")

    await database.insert(transactions).values({
      ...baseTransaction("txn-links-ugc"),
      aiBudgetId: "budget-ai",
      aiSubscriptionId: "subscription-ai",
      ugcBudgetId: "budget-ugc",
      ugcSubscriptionId: "subscription-ugc",
    })
    // ai's trip guess is rejected, ugc assigns a different trip - the resolved
    // trip_id must reflect the live (non-rejected) assignment, not either
    // source unconditionally.
    await database.insert(transactionTags).values([
      {
        transactionId: "txn-links-ugc",
        tagId: "trip-ai",
        kind: "trip",
        source: "ugc",
        isRejected: true,
      },
      { transactionId: "txn-links-ugc", tagId: "trip-ugc", kind: "trip", source: "ugc" },
    ])
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

  test("business_id resolves to the root, not the tagged child", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-business") })
    await database.insert(transactionTags).values({
      transactionId: "txn-business",
      tagId: "biz-child",
      kind: "business",
      source: "ai",
    })
    const row = await resolvedRow("txn-business")
    expect(row?.businessId).toBe("biz-root")
  })

  test("business_id null when rejected", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-business-rejected") })
    await database.insert(transactionTags).values({
      transactionId: "txn-business-rejected",
      tagId: "biz-root",
      kind: "business",
      source: "ugc",
      isRejected: true,
    })
    const row = await resolvedRow("txn-business-rejected")
    expect(row?.businessId).toBeNull()
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

  test("tags: aggregates with each row's source stamp and resolved path", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-tags") })
    await database.insert(transactionTags).values([
      {
        transactionId: "txn-tags",
        tagId: "tag-ai",
        kind: "label",
        source: "ai",
        aiConfidence: 0.9,
      },
      { transactionId: "txn-tags", tagId: "tag-ugc", kind: "label", source: "ugc" },
      { transactionId: "txn-tags", tagId: "cat-food", kind: "label", source: "ugc" },
    ])

    const row = await resolvedRow("txn-tags")
    expect(row?.tags).toHaveLength(3)
    expect(row?.tags?.map((tag) => tag.source).sort()).toEqual(["ai", "ugc", "ugc"])
    expect(row?.tags?.map((tag) => tag.name).sort()).toEqual(["ai-tag", "food", "ugc-tag"])
    const nestedTag = row?.tags?.find((tag) => tag.id === "cat-food")
    expect(nestedTag?.path).toBe("cat / food")
    expect(nestedTag?.parentId).toBe("cat")
    const rootTag = row?.tags?.find((tag) => tag.id === "tag-ai")
    expect(rootTag?.path).toBe("ai-tag")
  })

  test("tags: color and emoji come through from the tag row", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-tags-color") })
    await database.insert(transactionTags).values({
      transactionId: "txn-tags-color",
      tagId: "tag-ugc",
      kind: "label",
      source: "ugc",
    })
    const row = await resolvedRow("txn-tags-color")
    const tag = row?.tags?.find((tag) => tag.id === "tag-ugc")
    expect(tag?.color).toBe("#8b5cf6")
    expect(tag?.emoji).toBe("🐈")
  })

  test("tags: color and emoji are null when the tag has none", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-tags-no-color") })
    await database.insert(transactionTags).values({
      transactionId: "txn-tags-no-color",
      tagId: "tag-ai",
      kind: "label",
      source: "ai",
      aiConfidence: 0.9,
    })
    const row = await resolvedRow("txn-tags-no-color")
    const tag = row?.tags?.find((tag) => tag.id === "tag-ai")
    expect(tag?.color).toBeNull()
    expect(tag?.emoji).toBeNull()
  })

  test("tags: rejected rows are absent", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-tags-rejected") })
    await database.insert(transactionTags).values({
      transactionId: "txn-tags-rejected",
      tagId: "tag-ai",
      kind: "label",
      source: "ugc",
      isRejected: true,
    })
    const row = await resolvedRow("txn-tags-rejected")
    expect(row?.tags).toEqual([])
  })

  test("tags: empty array, not null, when a transaction has none", async () => {
    await database.insert(transactions).values({ ...baseTransaction("txn-no-tags") })
    const row = await resolvedRow("txn-no-tags")
    expect(row?.tags).toEqual([])
  })
})
