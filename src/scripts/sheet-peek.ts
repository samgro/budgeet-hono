// Usage: bun run src/scripts/sheet-peek.ts (reads GOOGLE_SERVICE_ACCOUNT_JSON
// and TILLER_SHEET_ID from .env.local)
//
// Prints the header row and row count for both Tiller tabs. Read-only, never
// touches the database - the first cheap check that the service account,
// the base64 blob, the sheet ID, and the sheet's share settings are all
// actually correct, before anything downstream depends on it. Grows a
// --mapped flag once tiller-map (SDG-190) exists, to preview rows after the
// sync transforms too.

import { createSheetsClient, decodeServiceAccount } from "../lib/sheets"

const serviceAccountBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
if (!serviceAccountBase64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set")

const sheetId = process.env.TILLER_SHEET_ID
if (!sheetId) throw new Error("TILLER_SHEET_ID is not set")

const credentials = decodeServiceAccount(serviceAccountBase64)
const sheetsClient = createSheetsClient({ credentials, sheetId })

const { transactionRows, accountRows } = await sheetsClient.fetchTillerSheets()

printTab("Transactions", transactionRows)
printTab("Accounts", accountRows)

function printTab(name: string, rows: string[][]) {
  const [header, ...dataRows] = rows
  console.log(`\n${name}   ${header?.length ?? 0} headers, ${dataRows.length} rows`)
  if (header) {
    console.log(`  ${header.map((columnName, index) => `${columnName}→${index}`).join("  ")}`)
  }
}
