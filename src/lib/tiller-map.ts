// Header-text mapping and row transforms for both Tiller tabs. Pure - no
// network, no database - so this is the real test surface for SDG-190.
// src/scripts/sheet-peek.ts --mapped is how this gets validated against the
// real sheet before anything touches Postgres.

import { parseTillerAmount, parseTillerBalance } from "./amounts"

// Case-insensitive: the Transactions tab spells it "Account ID", the Accounts
// tab spells it "Account Id". Header text, never column letter - inserting
// Merchant Name shifted every letter to its right (see CLAUDE.md).
//
// Both real tabs also have genuine header-name collisions: a visible
// user-editable quick-view block (Account, Group, Hide on Accounts) sits to
// the left of Tiller's real managed data feed, which repeats those same
// names. Iterating left to right and letting a later Map.set overwrite an
// earlier one resolves to the managed block in both tabs - verified against
// the real sheet, see the note on SDG-190.
export function buildHeaderMap(headerRow: string[]): Map<string, number> {
  const headerMap = new Map<string, number>()
  headerRow.forEach((rawName, index) => {
    const name = rawName.trim().toLowerCase()
    if (!name) return
    headerMap.set(name, index)
  })
  return headerMap
}

function cell(row: string[], headerMap: Map<string, number>, headerName: string): string {
  const index = headerMap.get(headerName.toLowerCase())
  if (index === undefined) return ""
  return (row[index] ?? "").trim()
}

const TILLER_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/

// Explicit parse, never new Date() - "8/1/26" is ambiguous and the runtime
// guesses wrong, silently poisoning a year of data (CLAUDE.md gotcha). Used
// for both Date and Last Update - confirmed against the real sheet that
// Last Update carries no time component, just M/D/YYYY like every other
// Tiller date column.
export function parseTillerDate(value: string): string {
  const match = TILLER_DATE_PATTERN.exec(value.trim())
  if (!match) throw new Error(`Unparseable Tiller date: "${value}"`)
  const [, monthText = "", dayText = "", yearText = ""] = match
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

interface CategoryHint {
  primary: string | null
  detailed: string | null
}

function splitCategoryHint(hint: string): CategoryHint {
  if (!hint) return { primary: null, detailed: null }
  const separatorIndex = hint.indexOf(": ")
  if (separatorIndex === -1) return { primary: null, detailed: hint }
  return {
    primary: hint.slice(0, separatorIndex),
    detailed: hint.slice(separatorIndex + 2),
  }
}

// Injected rather than read from the DB in here, so this module stays pure -
// lib/ingest.ts (SDG-192) builds this from `select detailed, primary,
// pfcv1_detailed from categories` and passes it in.
export interface CategoryAliases {
  // v2 detailed -> v2 primary
  knownDetailed: Map<string, string>
  // v1 alias -> v2 detailed. Only carries entries where the two codes
  // actually differ - resolveCategory's own fallback (`?? hint.detailed`)
  // below already covers the ~120 codes that don't drift, so
  // loadCategoryAliases (lib/ingest.ts) doesn't bother writing identity
  // entries for them.
  v1ToV2: Map<string, string>
}

interface ResolvedCategory {
  primary: string | null
  detailed: string | null
  // Set only when the code is genuinely unknown to the taxonomy - neither a
  // known v2 code nor a known v1 alias. Reported, never rejected: Plaid emits
  // codes ahead of our seed (CLAUDE.md gotcha).
  unknown: string | null
}

// raw_category_primary comes from the *resolved* v2 category, not the
// sheet's own split - most v1 aliases keep their primary, but a few don't
// (TRANSFER_IN_CASH_ADVANCES_AND_LOANS -> LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT
// moves from TRANSFER_IN to LOAN_DISBURSEMENTS). Taking primary straight from
// the sheet would store a mismatched pair.
function resolveCategory(hint: CategoryHint, aliases: CategoryAliases): ResolvedCategory {
  if (!hint.detailed) return { primary: null, detailed: null, unknown: null }
  const v2Detailed = aliases.v1ToV2.get(hint.detailed) ?? hint.detailed
  const v2Primary = aliases.knownDetailed.get(v2Detailed)
  if (v2Primary) return { primary: v2Primary, detailed: v2Detailed, unknown: null }
  // Not in the taxonomy at all - pass the sheet's own hint through as free
  // text. raw_category_detailed has no FK precisely so this is legal.
  return { primary: hint.primary, detailed: hint.detailed, unknown: hint.detailed }
}

export interface TillerTransaction {
  id: string
  accountId: string
  rawDate: string
  rawAmount: string
  rawDescription: string
  rawFullDescription: string | null
  rawMerchantName: string | null
  rawCategoryPrimary: string | null
  rawCategoryDetailed: string | null
  rawCheckNumber: string | null
  rawImportedAt: string | null
}

export interface MapTransactionRowsOptions {
  windowStart: string // "YYYY-MM-DD"
  knownDetailed: Map<string, string>
  v1ToV2: Map<string, string>
}

export interface MapTransactionRowsResult {
  transactions: TillerTransaction[]
  rowsRead: number
  unknownCategories: string[]
}

// Transforms, in spec §6 order: skip non-Plaid/blank-id rows -> parse date
// explicitly -> drop rows before windowStart (inclusive boundary: a row dated
// exactly windowStart is kept) -> flip the amount sign -> split the category
// hint -> normalize v1 -> v2.
export function mapTransactionRows(
  rows: string[][],
  options: MapTransactionRowsOptions,
): MapTransactionRowsResult {
  const [headerRow, ...dataRows] = rows
  const headerMap = buildHeaderMap(headerRow ?? [])
  const aliases: CategoryAliases = { knownDetailed: options.knownDetailed, v1ToV2: options.v1ToV2 }

  const transactions: TillerTransaction[] = []
  const unknownCategories = new Set<string>()

  for (const row of dataRows) {
    if (cell(row, headerMap, "source") !== "Plaid") continue
    const id = cell(row, headerMap, "transaction id")
    if (!id) continue

    const rawDate = parseTillerDate(cell(row, headerMap, "date"))
    if (rawDate < options.windowStart) continue

    const hint = splitCategoryHint(cell(row, headerMap, "category hint"))
    const resolved = resolveCategory(hint, aliases)
    if (resolved.unknown) unknownCategories.add(resolved.unknown)

    const importedAt = cell(row, headerMap, "date added")

    transactions.push({
      id,
      accountId: cell(row, headerMap, "account id"),
      rawDate,
      rawAmount: parseTillerAmount(cell(row, headerMap, "amount")),
      rawDescription: cell(row, headerMap, "description"),
      rawFullDescription: cell(row, headerMap, "full description") || null,
      rawMerchantName: cell(row, headerMap, "merchant name") || null,
      rawCategoryPrimary: resolved.primary,
      rawCategoryDetailed: resolved.detailed,
      rawCheckNumber: cell(row, headerMap, "check number") || null,
      rawImportedAt: importedAt ? parseTillerDate(importedAt) : null,
    })
  }

  return { transactions, rowsRead: dataRows.length, unknownCategories: [...unknownCategories] }
}

export type TillerAccountType = "checking" | "savings" | "credit" | "investment" | "loan" | "other"
export type TillerAccountClass = "asset" | "liability"

const ACCOUNT_TYPE_ALIASES: Record<string, TillerAccountType> = {
  checking: "checking",
  savings: "savings",
  "credit card": "credit",
  investment: "investment",
  loan: "loan",
}

function normalizeAccountType(raw: string): TillerAccountType {
  return ACCOUNT_TYPE_ALIASES[raw.trim().toLowerCase()] ?? "other"
}

function normalizeAccountClass(raw: string): TillerAccountClass {
  return raw.trim().toLowerCase() === "liability" ? "liability" : "asset"
}

export interface TillerAccount {
  id: string
  rawName: string
  rawMask: string | null
  rawInstitution: string
  rawType: TillerAccountType
  rawClass: TillerAccountClass
  rawBalance: string | null
  rawBalanceAsOf: string | null
}

// No Source/window filtering here - accounts sync in full every run (spec
// §5): 11 rows, and a balance is point-in-time, not something a date window
// makes sense against. `Hide` is deliberately not read: its only legal home
// is accounts.ugc_is_hidden, a ugc_ column, and invariant #1 forbids sync
// from writing one. Hiding an account stays yours alone.
export function mapAccountRows(rows: string[][]): TillerAccount[] {
  const [headerRow, ...dataRows] = rows
  const headerMap = buildHeaderMap(headerRow ?? [])

  return dataRows
    .filter((row) => cell(row, headerMap, "account id"))
    .map((row) => {
      const lastUpdate = cell(row, headerMap, "last update")
      return {
        id: cell(row, headerMap, "account id"),
        rawName: cell(row, headerMap, "account"),
        rawMask: cell(row, headerMap, "account #") || null,
        rawInstitution: cell(row, headerMap, "institution"),
        rawType: normalizeAccountType(cell(row, headerMap, "type")),
        rawClass: normalizeAccountClass(cell(row, headerMap, "class")),
        rawBalance: parseTillerBalance(cell(row, headerMap, "last balance")),
        rawBalanceAsOf: lastUpdate ? parseTillerDate(lastUpdate) : null,
      }
    })
}
