// Usage:
//   bun run src/scripts/sheet-peek.ts                (reads GOOGLE_SERVICE_ACCOUNT_JSON
//   bun run src/scripts/sheet-peek.ts --mapped [n]     and TILLER_SHEET_ID from .env.local)
//
// Default mode prints the header row and row count for both Tiller tabs -
// the first cheap check that the service account, the base64 blob, the sheet
// ID, and the sheet's share settings are all actually correct, before
// anything downstream depends on it.
//
// --mapped runs the real sync transforms (src/lib/tiller-map.ts) over the
// live sheet and prints the n most recent mapped transactions plus all
// mapped accounts (default n=5), along with any unknown category codes - the
// last cheap place to catch a sign, date, or category error before anything
// touches the database. The category alias map comes straight from the
// committed taxonomy CSV, not the database, so this script stays read-only
// and DB-free.
import { parsePfcTaxonomy } from "../lib/pfc"
import { createSheetsClient, decodeServiceAccount } from "../lib/sheets"
import { mapAccountRows, mapTransactionRows } from "../lib/tiller-map"

const serviceAccountBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
if (!serviceAccountBase64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set")

const sheetId = process.env.TILLER_SHEET_ID
if (!sheetId) throw new Error("TILLER_SHEET_ID is not set")

const credentials = decodeServiceAccount(serviceAccountBase64)
const sheetsClient = createSheetsClient({ credentials, sheetId })

const { transactionRows, accountRows } = await sheetsClient.fetchTillerSheets()

const mappedFlagIndex = process.argv.indexOf("--mapped")

if (mappedFlagIndex === -1) {
  printTab("Transactions", transactionRows)
  printTab("Accounts", accountRows)
} else {
  const previewCount = Number(process.argv[mappedFlagIndex + 1] ?? "5")
  await printMapped(previewCount)
}

function printTab(name: string, rows: string[][]) {
  const [header, ...dataRows] = rows
  console.log(`\n${name}   ${header?.length ?? 0} headers, ${dataRows.length} rows`)
  if (header) {
    console.log(`  ${header.map((columnName, index) => `${columnName}→${index}`).join("  ")}`)
  }
}

async function printMapped(previewCount: number) {
  const csvPath = new URL("../db/seeds/pfc-taxonomy-all.csv", import.meta.url)
  const csvText = await Bun.file(csvPath).text()
  const categories = parsePfcTaxonomy(csvText)
  const knownDetailed = new Map(categories.map((category) => [category.detailed, category.primary]))
  const v1ToV2 = new Map(
    categories.flatMap((category) =>
      category.pfcv1Detailed.map((v1Code): [string, string] => [v1Code, category.detailed]),
    ),
  )

  // No window filter here - this is for eyeballing the transforms, not
  // simulating a real sync run, so nothing should be dropped for date reasons.
  const { transactions, rowsRead, unknownCategories } = mapTransactionRows(transactionRows, {
    windowStart: "1900-01-01",
    knownDetailed,
    v1ToV2,
  })
  // Sort by date desc, but only by date: Array.prototype.sort is stable, so
  // same-day rows keep the sheet's own top-to-bottom order. raw_imported_at
  // looked like a natural tiebreaker but isn't one - it's when Tiller's batch
  // happened to process the row, not when the transaction itself occurred,
  // and using it demoted the sheet's actual most-recent row (dated the same
  // day, imported a batch earlier) out of the top 5.
  const mostRecent = [...transactions]
    .sort((a, b) => (a.rawDate < b.rawDate ? 1 : a.rawDate > b.rawDate ? -1 : 0))
    .slice(0, previewCount)

  console.log(`\nTransactions: ${rowsRead} rows read, ${transactions.length} mapped`)
  console.log(`Most recent ${mostRecent.length}:`)
  for (const transaction of mostRecent) {
    console.log(transaction)
  }
  if (unknownCategories.length) {
    console.log(`\nUnknown categories (${unknownCategories.length}):`, unknownCategories)
  }

  const accounts = mapAccountRows(accountRows)
  console.log(`\nAccounts: ${accounts.length} mapped`)
  for (const account of accounts) {
    console.log(account)
  }
}
