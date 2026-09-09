// Exercises lib/accounts.ts. parseAccountQuery is pure; listAccounts goes
// through PGlite (src/db/testing.ts). No separate resolved-accounts.test.ts:
// the view is one name-resolution expression with no aggregate or
// root-collapsing logic to earn its own file, so the name-resolution tests
// below exercise it directly through the only caller.

import { beforeAll, describe, expect, test } from "bun:test"
import { accounts } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import { InvalidAccountQueryError, listAccounts, parseAccountQuery } from "./accounts"

describe("parseAccountQuery", () => {
  test("no params → defaults", () => {
    expect(parseAccountQuery({})).toEqual({ includeHidden: false })
  })

  test("includeHidden=true → true", () => {
    expect(parseAccountQuery({ includeHidden: "true" })).toEqual({ includeHidden: true })
  })

  test("includeHidden=false → false", () => {
    expect(parseAccountQuery({ includeHidden: "false" })).toEqual({ includeHidden: false })
  })

  test("includeHidden=yes → throws InvalidAccountQueryError", () => {
    expect(() => parseAccountQuery({ includeHidden: "yes" })).toThrow(InvalidAccountQueryError)
  })
})

describe("listAccounts", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>

  beforeAll(async () => {
    database = await createTestDatabase()

    // Inserted in an order that is neither the expected output order nor
    // alphabetical, so a missing orderBy fails rather than accidentally
    // passing.
    await database.insert(accounts).values([
      {
        id: "account-total",
        rawName: "Total Checking",
        rawInstitution: "Chase",
        rawType: "checking",
        rawClass: "asset",
      },
      {
        id: "account-old",
        rawName: "Old Card",
        rawInstitution: "Amex",
        rawType: "credit",
        rawClass: "liability",
        ugcIsHidden: true,
      },
      {
        id: "account-zelle",
        rawName: "Zelle Checking",
        rawInstitution: "Wells Fargo",
        rawType: "checking",
        rawClass: "asset",
        rawMask: "4471",
        rawBalance: "312.09",
        rawBalanceAsOf: new Date("2026-09-07T12:00:00.000Z"),
      },
      {
        id: "account-sapphire",
        rawName: "Ultimate Rewards®",
        ugcName: "Sapphire",
        rawInstitution: "Chase",
        rawType: "credit",
        rawClass: "liability",
      },
      {
        id: "account-blank",
        rawName: "Savings",
        // Whitespace-only, not null - proves nullif(trim(...)) treats this
        // as blank too, not just an absent column.
        ugcName: "   ",
        rawInstitution: "Ally",
        rawType: "savings",
        rawClass: "asset",
      },
    ])
  })

  test("resolves ugc_name over the fallback when it's set", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const sapphire = rows.find((row) => row.id === "account-sapphire")
    expect(sapphire).toMatchObject({ name: "Sapphire", rawName: "Ultimate Rewards®" })
  })

  test("falls back to 'institution rawName' when there's no ugc_name and no mask", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const total = rows.find((row) => row.id === "account-total")
    expect(total).toMatchObject({ name: "Chase Total Checking", rawName: "Total Checking" })
  })

  test("falls back to 'institution rawName ••mask' when there's a mask", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const zelle = rows.find((row) => row.id === "account-zelle")
    expect(zelle).toMatchObject({ name: "Wells Fargo Zelle Checking ••4471" })
  })

  test("a whitespace-only ugc_name is treated as blank, not as an override", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const blank = rows.find((row) => row.id === "account-blank")
    expect(blank).toMatchObject({ name: "Ally Savings" })
  })

  test("orders by institution, then resolved name — not raw name", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    // Within Chase, "Chase Total Checking" sorts before "Sapphire" - proof
    // ordering compares the resolved name (fallback included), not raw_name
    // and not a plain ugc_name-vs-fallback split.
    expect(rows.map((row) => row.id)).toEqual([
      "account-blank",
      "account-total",
      "account-sapphire",
      "account-zelle",
    ])
  })

  test("excludes hidden accounts by default", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    expect(rows.map((row) => row.id)).not.toContain("account-old")
  })

  test("includeHidden: true returns the hidden account too", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: true })
    expect(rows.map((row) => row.id)).toEqual([
      "account-blank",
      "account-old",
      "account-total",
      "account-sapphire",
      "account-zelle",
    ])
  })

  test("balance is a string, balanceAsOf is an ISO-8601 string", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const zelle = rows.find((row) => row.id === "account-zelle")
    expect(zelle?.balance).toBe("312.09")
    expect(zelle?.balanceAsOf).toBe("2026-09-07T12:00:00.000Z")
  })

  test("balance and balanceAsOf are null when the account carries no balance", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const total = rows.find((row) => row.id === "account-total")
    expect(total?.balance).toBeNull()
    expect(total?.balanceAsOf).toBeNull()
  })

  test("carries mask, type, and class through from the base table", async () => {
    const { accounts: rows } = await listAccounts(database, { includeHidden: false })
    const zelle = rows.find((row) => row.id === "account-zelle")
    expect(zelle).toMatchObject({ mask: "4471", type: "checking", class: "asset" })
  })
})
