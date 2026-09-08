// Exercises the tags/transaction_tags constraints added in SDG-209 against a
// real (in-memory) Postgres via PGlite - see src/db/testing.ts. Each of these
// constraints is the actual deliverable: the schema enforces the one-level
// hierarchy and the trip/business exclusivity rules structurally, and this
// file proves the enforcement rather than trusting the DDL by inspection.

import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { accounts, tags, transactions, transactionTags } from "./schema"
import { createTestDatabase } from "./testing"

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>

let database: TestDatabase

beforeEach(async () => {
  database = await createTestDatabase()
})

// Drizzle's query builders are thenables, not real Promise instances, so
// `expect(builder).rejects` fails to even recognize them as a promise.
// Wrapping in Promise.resolve gives bun:test a genuine Promise to assert on.
async function expectRejection(queryBuilder: PromiseLike<unknown>) {
  await expect(Promise.resolve(queryBuilder)).rejects.toThrow()
}

describe("tags hierarchy", () => {
  test("two-level nesting inserts", async () => {
    await database.insert(tags).values({ id: "cat", name: "cat" })
    await database.insert(tags).values({ id: "cat-food", parentId: "cat", name: "food" })
    const [child] = await database.select().from(tags).where(eq(tags.id, "cat-food"))
    expect(child?.parentId).toBe("cat")
  })

  test("three-level nesting fails on the depth composite FK", async () => {
    await database.insert(tags).values({ id: "cat", name: "cat" })
    await database.insert(tags).values({ id: "cat-food", parentId: "cat", name: "food" })
    await expectRejection(
      database.insert(tags).values({ id: "cat-food-treats", parentId: "cat-food", name: "treats" }),
    )
  })

  test("a child whose kind differs from its parent fails", async () => {
    await database.insert(tags).values({ id: "dphq", kind: "business", name: "DPHQ" })
    await expectRejection(
      database
        .insert(tags)
        .values({ id: "dphq-bad", parentId: "dphq", kind: "label", name: "bad" }),
    )
  })

  test("duplicate sibling names rejected; the same name under different parents accepted", async () => {
    await database.insert(tags).values([
      { id: "cat", name: "cat" },
      { id: "groceries", name: "groceries" },
    ])
    await database.insert(tags).values({ id: "cat-food", parentId: "cat", name: "food" })
    await expectRejection(
      database.insert(tags).values({ id: "cat-food-2", parentId: "cat", name: "food" }),
    )
    // Same name, different parent - a different tag, not a collision.
    await database
      .insert(tags)
      .values({ id: "groceries-food", parentId: "groceries", name: "food" })
  })

  test("two root tags named 'cat' rejected", async () => {
    await database.insert(tags).values({ id: "cat", name: "cat" })
    await expectRejection(database.insert(tags).values({ id: "cat-2", name: "cat" }))
  })

  test("kind = 'trip' without start_date rejected; a label with one also rejected", async () => {
    await expectRejection(
      database.insert(tags).values({ id: "trip-no-window", kind: "trip", name: "AU/NZ" }),
    )
    await expectRejection(
      database.insert(tags).values({
        id: "label-with-window",
        kind: "label",
        name: "cat",
        startDate: "2026-01-01",
      }),
    )
  })

  test("end_date before start_date rejected", async () => {
    await expectRejection(
      database.insert(tags).values({
        id: "backwards-trip",
        kind: "trip",
        name: "AU/NZ",
        startDate: "2026-08-24",
        endDate: "2026-08-01",
      }),
    )
  })

  test("deleting a parent with children fails; deleting a childless tag cascades its join rows", async () => {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    await database.insert(transactions).values({
      id: "txn-1",
      accountId: "account-1",
      rawDate: "2026-08-01",
      rawAmount: "10.00",
      rawDescription: "Test",
    })
    await database.insert(tags).values({ id: "cat", name: "cat" })
    await database.insert(tags).values({ id: "cat-food", parentId: "cat", name: "food" })

    await expectRejection(database.delete(tags).where(eq(tags.id, "cat")))

    await database.insert(transactionTags).values({
      transactionId: "txn-1",
      tagId: "cat-food",
      kind: "label",
      source: "ai",
    })
    // Childless (no tag has cat-food as a parent), so this succeeds and
    // cascades the transaction_tags row with it.
    await database.delete(tags).where(eq(tags.id, "cat-food"))
    const remaining = await database.select().from(transactionTags)
    expect(remaining).toHaveLength(0)
  })
})

describe("transaction_tags exclusivity", () => {
  async function seedTransaction(id: string) {
    await database.insert(accounts).values({
      id: "account-1",
      rawName: "Checking",
      rawInstitution: "Chase",
      rawType: "checking",
      rawClass: "asset",
    })
    await database.insert(transactions).values({
      id,
      accountId: "account-1",
      rawDate: "2026-08-01",
      rawAmount: "10.00",
      rawDescription: "Test",
    })
  }

  async function seedTags() {
    await database.insert(tags).values([
      {
        id: "trip-1",
        kind: "trip",
        name: "Trip 1",
        startDate: "2026-01-01",
        endDate: "2026-01-10",
      },
      {
        id: "trip-2",
        kind: "trip",
        name: "Trip 2",
        startDate: "2026-02-01",
        endDate: "2026-02-10",
      },
      { id: "biz-1", kind: "business", name: "Biz 1" },
      { id: "biz-2", kind: "business", name: "Biz 2" },
      { id: "label-1", kind: "label", name: "cat" },
    ])
  }

  test("a second trip on one transaction rejected", async () => {
    await seedTransaction("txn-1")
    await seedTags()
    await database
      .insert(transactionTags)
      .values({ transactionId: "txn-1", tagId: "trip-1", kind: "trip", source: "ai" })
    await expectRejection(
      database
        .insert(transactionTags)
        .values({ transactionId: "txn-1", tagId: "trip-2", kind: "trip", source: "ai" }),
    )
  })

  test("a second business rejected", async () => {
    await seedTransaction("txn-1")
    await seedTags()
    await database
      .insert(transactionTags)
      .values({ transactionId: "txn-1", tagId: "biz-1", kind: "business", source: "ai" })
    await expectRejection(
      database
        .insert(transactionTags)
        .values({ transactionId: "txn-1", tagId: "biz-2", kind: "business", source: "ai" }),
    )
  })

  test("one trip plus one business plus any number of labels accepted", async () => {
    await seedTransaction("txn-1")
    await seedTags()
    await database.insert(transactionTags).values([
      { transactionId: "txn-1", tagId: "trip-1", kind: "trip", source: "ai" },
      { transactionId: "txn-1", tagId: "biz-1", kind: "business", source: "ai" },
      { transactionId: "txn-1", tagId: "label-1", kind: "label", source: "ugc" },
    ])
    const rows = await database.select().from(transactionTags)
    expect(rows).toHaveLength(3)
  })

  test("a rejected row does not count toward the trip/business limit", async () => {
    await seedTransaction("txn-1")
    await seedTags()
    await database.insert(transactionTags).values({
      transactionId: "txn-1",
      tagId: "trip-1",
      kind: "trip",
      source: "ugc",
      isRejected: true,
    })
    // The rejection tombstones trip-1, but a live assignment of a different
    // trip is still allowed - the exclusivity is over non-rejected rows only.
    await database
      .insert(transactionTags)
      .values({ transactionId: "txn-1", tagId: "trip-2", kind: "trip", source: "ai" })
    const rows = await database.select().from(transactionTags)
    expect(rows).toHaveLength(2)
  })

  test("is_rejected with source = 'ai' rejected", async () => {
    await seedTransaction("txn-1")
    await seedTags()
    await expectRejection(
      database.insert(transactionTags).values({
        transactionId: "txn-1",
        tagId: "trip-1",
        kind: "trip",
        source: "ai",
        isRejected: true,
      }),
    )
  })
})
