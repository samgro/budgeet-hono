// Orchestration for POST /sync (SDG-191). Takes the sheets client as a
// parameter so tests inject a fake, and takes an already-*pinned* Database
// (never a pooled DatabaseClient) — the caller (src/routes/sync.ts) is
// responsible for pinning via withPinnedConnection before calling in here.
// That's what lets this run unmodified against PGlite in tests: PGlite is
// already a single connection, so there's nothing to pin.

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm"
import type { Database } from "../db/client"
import { syncRuns, transactions } from "../db/schema"
import { loadCategoryAliases, upsertAccounts, upsertTransactions } from "./ingest"
import type { SheetsClient } from "./sheets"
import { mapAccountRows, mapTransactionRows } from "./tiller-map"

const MIN_INTERVAL_MS = 5 * 60 * 1000
const STALE_RUNNING_INTERVAL = sql`interval '10 minutes'`

// Arbitrary, but must stay stable across deploys — it's the identity of the
// lock, not a magic number to "clean up" later.
const SYNC_LOCK_KEY = 725_814_001

export interface SyncResult {
  syncRunId: string
  windowStart: string
  rowsRead: number
  accountsUpserted: number
  txnsInserted: number
  txnsUpdated: number
  unknownCategories: string[]
  unclassifiedCount: number
  skipped: boolean
}

export interface RunSyncOptions {
  windowStart: string // "YYYY-MM-DD"
  force?: boolean
}

// Abstracts pg_try_advisory_lock/pg_advisory_unlock so contention can be
// tested without a second real connection — PGlite is single-connection, so
// the only way to exercise the "lock is held" branch offline is to inject a
// fake that says so.
export interface SyncLock {
  tryAcquire(database: Database): Promise<boolean>
  release(database: Database): Promise<void>
}

interface AdvisoryLockRow {
  acquired: boolean
}

export const advisoryLock: SyncLock = {
  async tryAcquire(database) {
    const result = (await database.execute(
      sql`select pg_try_advisory_lock(${SYNC_LOCK_KEY}) as acquired`,
    )) as { rows: AdvisoryLockRow[] }
    return Boolean(result.rows[0]?.acquired)
  },
  async release(database) {
    await database.execute(sql`select pg_advisory_unlock(${SYNC_LOCK_KEY})`)
  },
}

const WINDOW_START_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export class InvalidWindowStartError extends Error {}

// First of the current month, UTC — the server's clock is what matters here,
// not any particular viewer's timezone.
export function defaultWindowStart(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  return `${year}-${month}-01`
}

// Pure and unit-tested on its own, per CLAUDE.md — the only validation
// routes/sync.ts needs to do is call this and catch InvalidWindowStartError.
export function resolveWindowStart(since: string | undefined, now: Date = new Date()): string {
  if (since === undefined) return defaultWindowStart(now)
  if (!WINDOW_START_PATTERN.test(since)) {
    throw new InvalidWindowStartError(`since must be YYYY-MM-DD, got "${since}"`)
  }
  return since
}

async function countUnclassified(database: Database): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(isNull(transactions.aiBudgetId), isNull(transactions.ugcBudgetId)))
  return row?.count ?? 0
}

type SyncRunRow = typeof syncRuns.$inferSelect

function toSyncResult(row: SyncRunRow, skipped: boolean, unclassifiedCount: number): SyncResult {
  return {
    syncRunId: row.id,
    windowStart: row.windowStart,
    rowsRead: row.rowsRead,
    accountsUpserted: row.accountsUpserted,
    txnsInserted: row.txnsInserted,
    txnsUpdated: row.txnsUpdated,
    unknownCategories: row.unknownCategories,
    unclassifiedCount,
    skipped,
  }
}

// The lock self-heals when a crashed process's connection drops — the
// sync_runs row doesn't. Run this before anything else so a run that died
// mid-flight doesn't linger as "running" forever and confuse the contention
// path below into reporting a syncRunId nothing is still working on.
async function markStaleRunningRowsAsError(database: Database): Promise<void> {
  await database
    .update(syncRuns)
    .set({ status: "error", error: "Sync run did not finish (stale)", finishedAt: new Date() })
    .where(
      and(
        eq(syncRuns.status, "running"),
        lt(syncRuns.startedAt, sql`now() - ${STALE_RUNNING_INTERVAL}`),
      ),
    )
}

async function performSync(
  database: Database,
  sheetsClient: SheetsClient,
  windowStart: string,
): Promise<SyncResult> {
  const syncRunId = `sr_${crypto.randomUUID()}`
  await database.insert(syncRuns).values({ id: syncRunId, windowStart, status: "running" })

  try {
    const { transactionRows, accountRows } = await sheetsClient.fetchTillerSheets()
    const { knownDetailed, v1ToV2 } = await loadCategoryAliases(database)

    const mappedAccounts = mapAccountRows(accountRows)
    const {
      transactions: mappedTransactions,
      rowsRead,
      unknownCategories,
    } = mapTransactionRows(transactionRows, { windowStart, knownDetailed, v1ToV2 })

    // Accounts first — transactions.account_id is a notNull FK, and Tiller's
    // Accounts tab must be upserted before a transaction can legally land.
    const accountsUpserted = await upsertAccounts(database, mappedAccounts)
    const { inserted: txnsInserted, updated: txnsUpdated } = await upsertTransactions(
      database,
      mappedTransactions,
    )

    const unclassifiedCount = await countUnclassified(database)

    await database
      .update(syncRuns)
      .set({
        finishedAt: new Date(),
        status: "ok",
        rowsRead,
        accountsUpserted,
        txnsInserted,
        txnsUpdated,
        unknownCategories,
      })
      .where(eq(syncRuns.id, syncRunId))

    return {
      syncRunId,
      windowStart,
      rowsRead,
      accountsUpserted,
      txnsInserted,
      txnsUpdated,
      unknownCategories,
      unclassifiedCount,
      skipped: false,
    }
  } catch (error) {
    // Surfaced to the caller (never console.error'd), and recorded so
    // `sync_runs` tells the truth about what happened.
    const message = error instanceof Error ? error.message : String(error)
    await database
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: "error", error: message })
      .where(eq(syncRuns.id, syncRunId))
    throw error
  }
}

export async function runSync(
  database: Database,
  sheetsClient: SheetsClient,
  options: RunSyncOptions,
  lock: SyncLock = advisoryLock,
): Promise<SyncResult> {
  const { windowStart, force = false } = options

  await markStaleRunningRowsAsError(database)

  if (!force) {
    const [lastOk] = await database
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "ok"))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1)
    if (lastOk?.finishedAt && Date.now() - lastOk.finishedAt.getTime() < MIN_INTERVAL_MS) {
      return toSyncResult(lastOk, true, await countUnclassified(database))
    }
  }

  const acquired = await lock.tryAcquire(database)
  if (!acquired) {
    // Hand back the in-flight run rather than queueing — a widget refresh
    // and a page mount will collide, and the caller wants an answer now.
    const [inFlight] = await database
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "running"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1)
    if (inFlight) return toSyncResult(inFlight, true, await countUnclassified(database))
    // The lock is held but nothing is marked running — a run must have
    // finished in the gap between the failed acquire and this read. Nothing
    // useful to report as "skipped": the caller should just retry.
    throw new Error("Sync lock is held but no in-flight sync_runs row was found")
  }

  try {
    return await performSync(database, sheetsClient, windowStart)
  } finally {
    await lock.release(database)
  }
}
