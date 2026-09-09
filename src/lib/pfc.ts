// Parses the Plaid PFC taxonomy CSV (https://plaid.com/documents/pfc-taxonomy-all.csv)
// into category rows, including the PFC v1 aliases Tiller actually emits.
//
// Tiller's Plaid integration is on PFC v1; this repo stores v2. The CSV carries
// the full v1 -> v2 mapping in its "PFCv1 Detailed" column, which is what lets
// sync (BUD-4) normalize an incoming v1 code before it ever reaches
// raw_category_detailed. Most v1 codes equal their v2 counterpart byte-for-byte;
// a handful drift (INCOME_WAGES -> INCOME_SALARY, etc.), and one v2 code
// (OTHER_OTHER) has two v1 aliases packed into one CSV cell, separated by " / ".
//
// Plaid's own description column is prose ("Purchases at coffee shops or
// cafes"), not a display name, and this app never renders it - display names
// come from the curated lib/category-names.ts map instead.

import { DETAILED_NAMES, PRIMARY_NAMES } from "./category-names"
import { parseCsv } from "./csv"

export interface PfcCategory {
  primary: string
  detailed: string
  name: string
  primaryName: string
  pfcv1Detailed: string[]
}

export function parsePfcTaxonomy(csvText: string): PfcCategory[] {
  const rows = parseCsv(csvText)

  // Row 0 is the header. Row 1 is Plaid's prose note about the v1/v2 split,
  // not a category - it has no PFCv2 Detailed value, same as any other blank row.
  const dataRows = rows.slice(1).filter((row) => row[0] && row[1])

  return dataRows.map((row) => {
    const [primary, detailed, , , pfcv1Cell] = row
    if (!primary || !detailed) throw new Error("PFC row missing primary or detailed code")

    const name = DETAILED_NAMES[detailed]
    const primaryName = PRIMARY_NAMES[primary]
    if (!name) throw new Error(`No curated name for detailed code "${detailed}"`)
    if (!primaryName) throw new Error(`No curated name for primary code "${primary}"`)

    return {
      primary,
      detailed,
      name,
      primaryName,
      pfcv1Detailed: pfcv1Cell ? pfcv1Cell.split(" / ").map((code) => code.trim()) : [],
    }
  })
}
