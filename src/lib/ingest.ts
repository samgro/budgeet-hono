// Database writes for /sync (SDG-192) - still no HTTP route, no Google
// Sheets client (that's lib/sync.ts, SDG-191). This is where mapped rows
// (tiller-map.ts) actually reach Postgres, and where invariant #1 - sync
// writes only raw_* columns plus last_seen_at/updated_at, never ai_* or
// ugc_* - is enforced structurally. See rawOnlySetClause below and its test
// in ingest.test.ts, which is the real deliverable of this stage.

import { getTableColumns, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import type { Database } from "../db/client"
import { accounts, categories, transactions } from "../db/schema"
import type { CategoryAliases, TillerAccount, TillerTransaction } from "./tiller-map"

// Postgres's bind-parameter limit is 65,535 per statement. Nowhere near that
// yet at Tiller-sheet volumes, but chunking is what keeps a single sync run
// safe as the table (or its column count) grows, rather than something that
// only gets fixed after it breaks in production.
const CHUNK_SIZE = 500

function chunk<Item>(items: Item[], size: number): Item[][] {
  const chunks: Item[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

// The set clause is computed from the schema, not hand-written, so a raw_
// column added later is picked up for free - and, more importantly, an ai_
// or ugc_ column can never be typed into it by hand. This is invariant #1
// enforced structurally; ingest.test.ts's invariant test proves the
// enforcement rather than re-listing the columns.
function rawOnlySetClause<Table extends PgTable>(table: Table) {
  const rawColumns = Object.entries(getTableColumns(table)).filter(([propertyName]) =>
    propertyName.startsWith("raw"),
  )
  return Object.fromEntries(
    rawColumns.map(([propertyName, column]) => [propertyName, sql.raw(`excluded.${column.name}`)]),
  )
}

// Injected into tiller-map.ts's mapTransactionRows, which stays pure and
// DB-free. v1ToV2 only needs entries where the v1 code actually differs from
// the v2 one - resolveCategory's own fallback (`?? hint.detailed`) already
// covers the ~120 codes in the taxonomy that don't drift, so this doesn't
// bother writing identity entries for them.
export async function loadCategoryAliases(database: Database): Promise<CategoryAliases> {
  const rows = await database
    .select({
      detailed: categories.detailed,
      primary: categories.primary,
      pfcv1Detailed: categories.pfcv1Detailed,
    })
    .from(categories)

  const knownDetailed = new Map(rows.map((row) => [row.detailed, row.primary]))
  const v1ToV2 = new Map<string, string>()
  for (const row of rows) {
    for (const v1Code of row.pfcv1Detailed) {
      v1ToV2.set(v1Code, row.detailed)
    }
  }

  return { knownDetailed, v1ToV2 }
}

// Accounts sync in full every run (spec §5) - 11 rows, no windowing, no
// chunking. Must run before upsertTransactions: transactions.account_id is
// notNull with an FK, so a transaction can't legally land before its account.
export async function upsertAccounts(
  database: Database,
  mappedAccounts: TillerAccount[],
): Promise<number> {
  if (mappedAccounts.length === 0) return 0

  const now = new Date()
  const rows = mappedAccounts.map((account) => ({
    id: account.id,
    rawName: account.rawName,
    rawMask: account.rawMask,
    rawInstitution: account.rawInstitution,
    rawType: account.rawType,
    rawClass: account.rawClass,
    rawBalance: account.rawBalance,
    // The column is a timestamp (default mode: Date), account.rawBalanceAsOf
    // is tiller-map.ts's plain "YYYY-MM-DD" - an unambiguous ISO date string,
    // unlike the raw sheet text, so new Date() here is safe.
    rawBalanceAsOf: account.rawBalanceAsOf ? new Date(account.rawBalanceAsOf) : null,
    updatedAt: now,
  }))

  await database
    .insert(accounts)
    .values(rows)
    .onConflictDoUpdate({
      target: accounts.id,
      set: { ...rawOnlySetClause(accounts), updatedAt: now },
    })

  return rows.length
}

export interface UpsertTransactionsResult {
  inserted: number
  updated: number
  // Reported, not silently dropped - see the guard below. Empty on every
  // real run once accounts have synced first, but a batch shouldn't 23503
  // just because Tiller's Accounts tab lags its Transactions tab by a row.
  skippedUnknownAccounts: string[]
}

export async function upsertTransactions(
  database: Database,
  mappedTransactions: TillerTransaction[],
): Promise<UpsertTransactionsResult> {
  if (mappedTransactions.length === 0)
    return { inserted: 0, updated: 0, skippedUnknownAccounts: [] }

  // A transaction referencing an account id Tiller hasn't (yet) surfaced on
  // the Accounts tab would otherwise fail the whole batch on the FK - filter
  // it out and report it instead.
  const knownAccounts = await database.select({ id: accounts.id }).from(accounts)
  const knownAccountIds = new Set(knownAccounts.map((account) => account.id))

  const eligible: TillerTransaction[] = []
  const skippedUnknownAccounts: string[] = []
  for (const transaction of mappedTransactions) {
    if (knownAccountIds.has(transaction.accountId)) eligible.push(transaction)
    else skippedUnknownAccounts.push(transaction.id)
  }

  const now = new Date()
  let inserted = 0
  let updated = 0

  for (const batch of chunk(eligible, CHUNK_SIZE)) {
    const rows = batch.map((transaction) => ({
      id: transaction.id,
      accountId: transaction.accountId,
      rawDate: transaction.rawDate,
      rawAmount: transaction.rawAmount,
      rawDescription: transaction.rawDescription,
      rawFullDescription: transaction.rawFullDescription,
      rawMerchantName: transaction.rawMerchantName,
      rawCategoryPrimary: transaction.rawCategoryPrimary,
      rawCategoryDetailed: transaction.rawCategoryDetailed,
      rawCheckNumber: transaction.rawCheckNumber,
      rawImportedAt: transaction.rawImportedAt,
      lastSeenAt: now,
      updatedAt: now,
    }))

    // xmax = 0 is the standard Postgres tell for "this returning row was
    // just inserted, not updated" - reliable here because lib/sync.ts
    // (SDG-191) holds an advisory lock across the whole run, so nothing else
    // is writing transactions concurrently.
    const result = await database
      .insert(transactions)
      .values(rows)
      .onConflictDoUpdate({
        target: transactions.id,
        set: { ...rawOnlySetClause(transactions), lastSeenAt: now, updatedAt: now },
      })
      .returning({ id: transactions.id, inserted: sql<boolean>`xmax = 0` })

    for (const row of result) {
      if (row.inserted) inserted++
      else updated++
    }
  }

  return { inserted, updated, skippedUnknownAccounts }
}
