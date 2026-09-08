// GET /transactions and GET /transactions/:id. Reads only resolved_transactions
// and resolved_accounts (schema.ts) - the ugc > ai > raw and ugc_name > raw_name
// precedence rules are resolved there, once, per CLAUDE.md. budgets, categories,
// and subscriptions carry no precedence rule, so joining them directly here
// doesn't create a second definition of anything.

import { and, desc, eq, exists, gte, ilike, isNotNull, isNull, lte, or, sql } from "drizzle-orm"
import type { Database } from "../db/client"
import {
  budgets,
  categories,
  corrections,
  resolvedAccounts,
  resolvedTransactions,
  subscriptions,
  tags,
  transactionTags,
} from "../db/schema"
import { type Cursor, decodeCursor, encodeCursor } from "./cursor"
import { isIsoDate } from "./dates"

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export class InvalidTransactionQueryError extends Error {}

export interface TransactionQuery {
  from?: string
  to?: string
  accountId?: string
  budgetId?: string
  tagId?: string
  subscriptionId?: string
  unassigned?: boolean
  // Already ilike-escaped and %-wrapped - the query builder never sees the
  // caller's raw string.
  searchPattern?: string
  includeHidden: boolean
  limit: number
  cursor?: Cursor
}

function parseTriState(value: string | undefined, parameterName: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === "true") return true
  if (value === "false") return false
  throw new InvalidTransactionQueryError(
    `${parameterName} must be "true" or "false", got "${value}"`,
  )
}

function parseDateParam(value: string | undefined, parameterName: string): string | undefined {
  if (value === undefined) return undefined
  if (!isIsoDate(value)) {
    throw new InvalidTransactionQueryError(`${parameterName} must be YYYY-MM-DD, got "${value}"`)
  }
  return value
}

function parseIdParam(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

// Unescaped, q=100% would match "1000 dollars" - ilike treats % and _ as
// wildcards, and the bare search string can't be trusted not to contain them.
function toSearchPattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (character) => `\\${character}`)
  return `%${escaped}%`
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT
  // Checked before parseInt, which silently accepts "50abc", "1e3", and
  // truncates "50.5" - all client bugs that should 400, not quietly resolve.
  if (!/^\d+$/.test(value)) {
    throw new InvalidTransactionQueryError(`limit must be a positive integer, got "${value}"`)
  }
  const parsed = Number.parseInt(value, 10)
  if (parsed === 0) {
    throw new InvalidTransactionQueryError("limit must be greater than 0")
  }
  // Clamped, not rejected, above MAX_LIMIT: the client's stop condition is
  // nextCursor === null, not "I got fewer rows than I asked for", so a client
  // asking for 500 and silently getting 200 still walks the full set correctly.
  return Math.min(parsed, MAX_LIMIT)
}

export function parseTransactionQuery(query: Record<string, string | undefined>): TransactionQuery {
  const rawSearch = query.q?.trim()

  return {
    from: parseDateParam(query.from, "from"),
    to: parseDateParam(query.to, "to"),
    accountId: parseIdParam(query.accountId),
    budgetId: parseIdParam(query.budgetId),
    tagId: parseIdParam(query.tagId),
    subscriptionId: parseIdParam(query.subscriptionId),
    unassigned: parseTriState(query.unassigned, "unassigned"),
    searchPattern:
      rawSearch === undefined || rawSearch === "" ? undefined : toSearchPattern(rawSearch),
    includeHidden: parseTriState(query.includeHidden, "includeHidden") ?? false,
    limit: parseLimit(query.limit),
    cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  }
}

// The view's id and date are typed nullable because a Postgres view carries no
// NOT NULL constraints for drizzle-kit to record - but id is the transactions
// primary key and date is raw_date, which is NOT NULL. Narrow once here rather
// than threading `string | null` through every response type and into the
// cursor.
function toCursor(row: { id: string | null; date: string | null }): Cursor {
  if (row.id === null || row.date === null) {
    throw new Error("resolved_transactions returned a row with a null id or date")
  }
  return { date: row.date, id: row.id }
}

const transactionSummaryColumns = {
  id: resolvedTransactions.id,
  date: resolvedTransactions.date,
  amount: resolvedTransactions.amount,
  description: resolvedTransactions.description,
  direction: resolvedTransactions.direction,
  budgetIsConfirmed: resolvedTransactions.budgetIsConfirmed,
  ugcNote: resolvedTransactions.ugcNote,
  ugcIsHidden: resolvedTransactions.ugcIsHidden,
  tags: resolvedTransactions.tags,
  account: {
    id: resolvedAccounts.id,
    name: resolvedAccounts.name,
    mask: resolvedAccounts.rawMask,
    institution: resolvedAccounts.rawInstitution,
    type: resolvedAccounts.rawType,
    class: resolvedAccounts.rawClass,
  },
  budget: {
    id: budgets.id,
    name: budgets.name,
    class: budgets.class,
    color: budgets.color,
    emoji: budgets.emoji,
  },
  category: {
    detailed: categories.detailed,
    primary: categories.primary,
    description: categories.description,
    iconUrl: categories.iconUrl,
  },
  subscription: {
    id: subscriptions.id,
    name: subscriptions.name,
  },
}

const transactionDetailColumns = {
  ...transactionSummaryColumns,
  rawAmount: resolvedTransactions.rawAmount,
  rawDescription: resolvedTransactions.rawDescription,
  rawMerchantName: resolvedTransactions.rawMerchantName,
  rawCategoryDetailed: resolvedTransactions.rawCategoryDetailed,
  aiConfidence: resolvedTransactions.aiConfidence,
  aiReasoning: resolvedTransactions.aiReasoning,
}

export async function listTransactions(database: Database, query: TransactionQuery) {
  const conditions = [
    query.from ? gte(resolvedTransactions.date, query.from) : undefined,
    query.to ? lte(resolvedTransactions.date, query.to) : undefined,
    query.accountId ? eq(resolvedTransactions.accountId, query.accountId) : undefined,
    query.budgetId ? eq(resolvedTransactions.budgetId, query.budgetId) : undefined,
    query.subscriptionId
      ? eq(resolvedTransactions.subscriptionId, query.subscriptionId)
      : undefined,
    query.unassigned === true ? isNull(resolvedTransactions.budgetId) : undefined,
    query.unassigned === false ? isNotNull(resolvedTransactions.budgetId) : undefined,
  ]

  // Hidden, at both levels, behind the one flag - resolvedAccounts is already
  // joined below, so this is a plain condition rather than an EXISTS.
  if (!query.includeHidden) {
    conditions.push(eq(resolvedTransactions.ugcIsHidden, false))
    conditions.push(eq(resolvedAccounts.ugcIsHidden, false))
  }

  // Agrees with the view, which already collapses business_id to the root -
  // filtering by a business root returns everything under it. Since trips
  // are tags too (SDG-209), this is also how a trip is filtered. is_rejected
  // is restated from the view's tags aggregate here; that's a fact about a
  // row, not a precedence rule, so restating it doesn't create the
  // two-definitions problem CLAUDE.md guards against for ugc/ai/raw.
  if (query.tagId) {
    conditions.push(
      exists(
        database
          .select({ present: sql`1` })
          .from(transactionTags)
          .innerJoin(tags, eq(tags.id, transactionTags.tagId))
          .where(
            and(
              eq(transactionTags.transactionId, resolvedTransactions.id),
              eq(transactionTags.isRejected, false),
              or(eq(tags.id, query.tagId), eq(tags.parentId, query.tagId)),
            ),
          ),
      ),
    )
  }

  // description alone is insufficient: it's coalesce(ugc_description,
  // raw_merchant_name, raw_description), so renaming a transaction makes the
  // merchant unsearchable.
  if (query.searchPattern) {
    const searchCondition = or(
      ilike(resolvedTransactions.description, query.searchPattern),
      ilike(resolvedTransactions.rawDescription, query.searchPattern),
      ilike(resolvedTransactions.rawMerchantName, query.searchPattern),
      ilike(resolvedTransactions.ugcNote, query.searchPattern),
    )
    if (searchCondition) conditions.push(searchCondition)
  }

  // Row-comparison keyset predicate. Drizzle has no helper for this, so raw
  // sql earns its place - the expanded or(lt(date), and(eq(date), lt(id)))
  // form is typed but is four nested expressions where the classic bug (<=
  // on the date leg) hides, and unlike this form it can never become an
  // index range scan against idx_txn_date_id.
  if (query.cursor) {
    conditions.push(
      sql`(${resolvedTransactions.date}, ${resolvedTransactions.id}) < (${query.cursor.date}::date, ${query.cursor.id}::text)`,
    )
  }

  const definedConditions = conditions.filter((condition) => condition !== undefined)

  // Sargability note: resolvedTransactions.budgetId is coalesce(ugc_budget_id,
  // ai_budget_id), so `budgetId = $1` (and the unassigned/subscriptionId
  // filters, same shape) cannot use idx_txn_budget and seq-scans instead. At
  // this dataset's size (one household, a few thousand rows/year) that's
  // single-digit milliseconds - well under a Neon cold-connection cost - and
  // pushing the OR down into the handler would just restate the precedence
  // rule a second time. If it ever matters, the fix is a base-table
  // expression index (`coalesce(ugc_budget_id, ai_budget_id)`), not a
  // handler-side COALESCE.
  const rows = await database
    .select(transactionDetailColumns)
    .from(resolvedTransactions)
    .innerJoin(resolvedAccounts, eq(resolvedAccounts.id, resolvedTransactions.accountId))
    .leftJoin(budgets, eq(budgets.id, resolvedTransactions.budgetId))
    .leftJoin(categories, eq(categories.detailed, resolvedTransactions.categoryDetailed))
    .leftJoin(subscriptions, eq(subscriptions.id, resolvedTransactions.subscriptionId))
    .where(and(...definedConditions))
    .orderBy(desc(resolvedTransactions.date), desc(resolvedTransactions.id))
    .limit(query.limit + 1)

  const hasNextPage = rows.length > query.limit
  const page = hasNextPage ? rows.slice(0, query.limit) : rows
  const lastRow = page.at(-1)

  return {
    transactions: page,
    nextCursor: hasNextPage && lastRow ? encodeCursor(toCursor(lastRow)) : null,
  }
}

export type TransactionPage = Awaited<ReturnType<typeof listTransactions>>

export async function getTransaction(database: Database, id: string) {
  // No hidden filter at either level - hiding is a list-view preference, not
  // an access rule. The response carries ugcIsHidden so the UI can render it,
  // and PATCH /transactions/:id will need to read a row to un-hide it.
  const [row] = await database
    .select(transactionDetailColumns)
    .from(resolvedTransactions)
    .innerJoin(resolvedAccounts, eq(resolvedAccounts.id, resolvedTransactions.accountId))
    .leftJoin(budgets, eq(budgets.id, resolvedTransactions.budgetId))
    .leftJoin(categories, eq(categories.detailed, resolvedTransactions.categoryDetailed))
    .leftJoin(subscriptions, eq(subscriptions.id, resolvedTransactions.subscriptionId))
    .where(eq(resolvedTransactions.id, id))
    .limit(1)

  if (row === undefined) return null

  // Sequential, not Promise.all: the 404 path above already returned, so the
  // extra round trip only costs on the success path, and this is a detail
  // view, not the widget's hot path.
  //
  // desc(id) is the tiebreak: idx_corr_recent is on created_at alone, and two
  // corrections written in one statement share a timestamp, so without it the
  // order is non-deterministic across runs. snap_* columns are omitted - they
  // exist to keep few-shot classifier examples truthful, not for UI.
  const correctionRows = await database
    .select({
      id: corrections.id,
      field: corrections.field,
      fromValue: corrections.fromValue,
      toValue: corrections.toValue,
      reason: corrections.reason,
      createdAt: corrections.createdAt,
    })
    .from(corrections)
    .where(eq(corrections.transactionId, id))
    .orderBy(desc(corrections.createdAt), desc(corrections.id))

  return {
    ...row,
    corrections: correctionRows.map((correction) => ({
      ...correction,
      createdAt: correction.createdAt.toISOString(),
    })),
  }
}
