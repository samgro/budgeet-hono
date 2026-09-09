// GET /accounts. Reads only resolved_accounts (schema.ts) - the display-name
// resolution rule (ugc_name, falling back to "institution rawName ••mask"
// when blank) is resolved there, once, per CLAUDE.md. No other table carries
// a precedence rule to protect, so there is nothing else to join.

import { eq } from "drizzle-orm"
import type { Database } from "../db/client"
import { resolvedAccounts } from "../db/schema"

export class InvalidAccountQueryError extends Error {}

export interface AccountQuery {
  includeHidden: boolean
}

// Copied from the identical helper in transactions.ts rather than shared -
// sharing it now means either a generic error class or an error-factory
// argument for two call sites. SDG-196 adds three more (?includeArchived on
// /budgets, ?includeInactive on /tags and /subscriptions); hoist once all
// five are known, not now guessing at two.
function parseTriState(value: string | undefined, parameterName: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === "true") return true
  if (value === "false") return false
  throw new InvalidAccountQueryError(`${parameterName} must be "true" or "false", got "${value}"`)
}

export function parseAccountQuery(query: Record<string, string | undefined>): AccountQuery {
  return {
    includeHidden: parseTriState(query.includeHidden, "includeHidden") ?? false,
  }
}

// Key names match the nested `account` object /transactions already returns
// (lib/transactions.ts) - mask, institution, type, class, not the raw*
// spellings - so a client parses one account shape everywhere. rawName is
// the one addition here, named for what it is.
const accountColumns = {
  id: resolvedAccounts.id,
  name: resolvedAccounts.name,
  rawName: resolvedAccounts.rawName,
  mask: resolvedAccounts.rawMask,
  institution: resolvedAccounts.rawInstitution,
  type: resolvedAccounts.rawType,
  class: resolvedAccounts.rawClass,
  balance: resolvedAccounts.rawBalance,
  balanceAsOf: resolvedAccounts.rawBalanceAsOf,
  ugcIsHidden: resolvedAccounts.ugcIsHidden,
}

export async function listAccounts(database: Database, query: AccountQuery) {
  const rows = await database
    .select(accountColumns)
    .from(resolvedAccounts)
    .where(query.includeHidden ? undefined : eq(resolvedAccounts.ugcIsHidden, false))
    // Institution, then the *resolved* name - a nicknamed account sorts
    // where the user sees it, not where the bank filed it.
    .orderBy(resolvedAccounts.rawInstitution, resolvedAccounts.name)

  return {
    // Every pgView column is typed T | null (a view carries no NOT NULL for
    // drizzle-kit to record), even though id/name/institution are NOT NULL
    // on the base table. Passed through as-is rather than narrowed - unlike
    // the transactions cursor, nothing downstream needs a non-null guarantee.
    accounts: rows.map((row) => ({
      ...row,
      // timestamp({ withTimezone: true }) -> a JS Date. Call .toISOString()
      // explicitly so the declared TS type matches what a client receives,
      // same reason getTransaction does it for corrections[].createdAt.
      balanceAsOf: row.balanceAsOf === null ? null : row.balanceAsOf.toISOString(),
    })),
  }
}

export type AccountList = Awaited<ReturnType<typeof listAccounts>>
