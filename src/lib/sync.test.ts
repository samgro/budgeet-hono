// Exercises lib/sync.ts against PGlite (src/db/testing.ts) with a fake sheets
// client — no network, no real advisory-lock contention (PGlite is a single
// connection). Contention is exercised by injecting a fake SyncLock instead;
// see "lock contention" below. The real advisory lock and the pinned-connection
// wiring in routes/sync.ts are covered by the ticket's manual Bruno DoD, not
// here — PGlite can't simulate a second real connection to contend against.

import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { syncRuns } from "../db/schema"
import { createTestDatabase } from "../db/testing"
import type { SheetsClient, TillerSheetsPayload } from "./sheets"
import type { SyncLock } from "./sync"
import { InvalidWindowStartError, resolveWindowStart, runSync } from "./sync"

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>

let database: TestDatabase

beforeEach(async () => {
  database = await createTestDatabase()
})

function fakeSheetsClient(payload: TillerSheetsPayload): SheetsClient & { callCount: number } {
  const client = {
    callCount: 0,
    async fetchTillerSheets() {
      client.callCount++
      return payload
    },
  }
  return client
}

const transactionRows = [
  ["Source", "Transaction Id", "Date", "Account Id", "Amount", "Description"],
  ["Plaid", "txn-1", "8/1/2026", "acct-1", "-45.00", "Grocery Store"],
  ["Plaid", "txn-2", "8/15/2026", "acct-1", "1200.00", "Paycheck"],
]

const accountRows = [
  [
    "Account Id",
    "Account",
    "Account #",
    "Institution",
    "Type",
    "Class",
    "Last Balance",
    "Last Update",
  ],
  ["acct-1", "Checking", "1234", "Chase", "Checking", "Asset", "500.00", "9/1/2026"],
]

const neverLock: SyncLock = {
  tryAcquire: async () => false,
  release: async () => {},
}

describe("runSync", () => {
  test("fetches, maps, upserts, and finishes the sync_runs row as ok", async () => {
    const sheetsClient = fakeSheetsClient({ transactionRows, accountRows })

    const result = await runSync(database, sheetsClient, { windowStart: "2026-08-01" })

    expect(result).toMatchObject({
      windowStart: "2026-08-01",
      rowsRead: 2,
      accountsUpserted: 1,
      txnsInserted: 2,
      txnsUpdated: 0,
      unknownCategories: [],
      unclassifiedCount: 2, // neither transaction has a budget assigned
      skipped: false,
    })
    expect(result.syncRunId.startsWith("sr_")).toBe(true)

    const [run] = await database.select().from(syncRuns).where(eq(syncRuns.id, result.syncRunId))
    expect(run?.status).toBe("ok")
    expect(run?.finishedAt).not.toBeNull()
  })

  test("min interval: an immediate second run without force returns the prior run, skipped", async () => {
    const sheetsClient = fakeSheetsClient({ transactionRows, accountRows })

    const first = await runSync(database, sheetsClient, { windowStart: "2026-08-01" })
    const second = await runSync(database, sheetsClient, { windowStart: "2026-08-01" })

    expect(second).toMatchObject({ syncRunId: first.syncRunId, skipped: true })
    // Short-circuited before ever touching Sheets - the whole point of the guard.
    expect(sheetsClient.callCount).toBe(1)
  })

  test("force=true bypasses the min-interval guard and runs again", async () => {
    const sheetsClient = fakeSheetsClient({ transactionRows, accountRows })

    const first = await runSync(database, sheetsClient, { windowStart: "2026-08-01" })
    const second = await runSync(database, sheetsClient, {
      windowStart: "2026-08-01",
      force: true,
    })

    expect(second.skipped).toBe(false)
    expect(second.syncRunId).not.toBe(first.syncRunId)
    // Same two rows, unchanged - second run is a pure refresh.
    expect(second).toMatchObject({ txnsInserted: 0, txnsUpdated: 2 })
    expect(sheetsClient.callCount).toBe(2)
  })

  test("lock contention: returns the in-flight run, skipped, without touching the sheets client", async () => {
    await database
      .insert(syncRuns)
      .values({ id: "sr_inflight", windowStart: "2026-08-01", status: "running" })
    const sheetsClient = fakeSheetsClient({ transactionRows, accountRows })

    const result = await runSync(
      database,
      sheetsClient,
      { windowStart: "2026-08-01", force: true },
      neverLock,
    )

    expect(result).toMatchObject({ syncRunId: "sr_inflight", skipped: true })
    expect(sheetsClient.callCount).toBe(0)
  })

  test("lock held with no matching running row throws rather than fabricating a result", async () => {
    const sheetsClient = fakeSheetsClient({ transactionRows, accountRows })

    await expect(
      runSync(database, sheetsClient, { windowStart: "2026-08-01", force: true }, neverLock),
    ).rejects.toThrow()
  })

  test("a running row older than 10 minutes is marked error before a new run starts", async () => {
    const staleStartedAt = new Date(Date.now() - 11 * 60 * 1000)
    await database.insert(syncRuns).values({
      id: "sr_stale",
      windowStart: "2026-08-01",
      status: "running",
      startedAt: staleStartedAt,
    })
    const sheetsClient = fakeSheetsClient({ transactionRows, accountRows })

    const result = await runSync(database, sheetsClient, { windowStart: "2026-08-01" })
    expect(result.skipped).toBe(false)

    const [stale] = await database.select().from(syncRuns).where(eq(syncRuns.id, "sr_stale"))
    expect(stale?.status).toBe("error")
  })

  test("a failed sheets fetch is recorded on the sync_runs row and rethrown", async () => {
    const sheetsClient: SheetsClient = {
      fetchTillerSheets: async () => {
        throw new Error("boom")
      },
    }

    await expect(runSync(database, sheetsClient, { windowStart: "2026-08-01" })).rejects.toThrow(
      "boom",
    )

    const [run] = await database.select().from(syncRuns).limit(1)
    expect(run?.status).toBe("error")
    expect(run?.error).toBe("boom")
  })
})

describe("resolveWindowStart", () => {
  test("defaults to the first of the current month, UTC", () => {
    const now = new Date("2026-08-21T12:00:00Z")
    expect(resolveWindowStart(undefined, now)).toBe("2026-08-01")
  })

  test("passes through a valid YYYY-MM-DD value", () => {
    expect(resolveWindowStart("2026-01-15")).toBe("2026-01-15")
  })

  test("rejects a non-YYYY-MM-DD value", () => {
    expect(() => resolveWindowStart("01/15/2026")).toThrow(InvalidWindowStartError)
  })
})
