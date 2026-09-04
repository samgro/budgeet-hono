import { describe, expect, test } from "bun:test"
import {
  buildHeaderMap,
  type CategoryAliases,
  mapAccountRows,
  mapTransactionRows,
  parseTillerDate,
} from "./tiller-map"

// Real column shapes, captured from the live Tiller sheet (see the note on
// SDG-190) rather than a synthetic layout that wouldn't have caught the
// hidden-column collisions. Transactions: column 0 is genuinely blank, and
// Transaction ID / Account ID / one of two Import Tag columns are hidden but
// still returned by values.batchGet. Accounts: a visible user quick-view
// block (0-3) sits left of Tiller's real managed feed (4-16), and Account /
// Group / Hide collide by name across the two blocks.
//
// Review and Tag were briefly added to the live sheet and then removed by
// hand - they were never read by mapTransactionRows, but this fixture is
// meant to mirror the real shape, so it dropped them too.
const TRANSACTIONS_HEADER_ROW = [
  "",
  "Date",
  "Description",
  "Amount",
  "Category",
  "Notes",
  "Account",
  "Account #",
  "Institution",
  "Month",
  "Week",
  "Transaction ID",
  "Account ID",
  "Import Tag",
  "Check Number",
  "Full Description",
  "Merchant Name",
  "Date Added",
  "Category Hint",
  "Categorized By",
  "Categorized Date",
  "Source",
  "Import Tag",
]

const ACCOUNTS_HEADER_ROW = [
  "Account",
  "Class Override",
  "Group",
  "Hide",
  "© 2026 Tiller",
  "Unique Account Identifier",
  "Account Id",
  "Last Update",
  "Last Balance",
  "Account",
  "Account #",
  "Institution",
  "Type",
  "Class (BH)",
  "Class",
  "Group",
  "Hide",
]

// Builds a data row by header name rather than numeric literal, so a test
// reads the same way buildHeaderMap resolves it - and stays correct if the
// fixture header row above ever changes.
function rowFrom(headerRow: string[], fields: Record<string, string>): string[] {
  const headerMap = buildHeaderMap(headerRow)
  const row = new Array(headerRow.length).fill("")
  for (const [name, value] of Object.entries(fields)) {
    const index = headerMap.get(name.toLowerCase())
    if (index === undefined) throw new Error(`fixture header not found: ${name}`)
    row[index] = value
  }
  return row
}

function transactionRow(fields: Record<string, string>): string[] {
  return rowFrom(TRANSACTIONS_HEADER_ROW, {
    Source: "Plaid",
    ...fields,
  })
}

function accountRow(fields: Record<string, string>): string[] {
  return rowFrom(ACCOUNTS_HEADER_ROW, fields)
}

describe("buildHeaderMap", () => {
  test("later same-named header wins - Accounts 'Account' resolves to the hidden managed block", () => {
    const headerMap = buildHeaderMap(ACCOUNTS_HEADER_ROW)
    expect(headerMap.get("account")).toBe(9)
    expect(headerMap.get("group")).toBe(15)
    expect(headerMap.get("hide")).toBe(16)
  })

  test("case-insensitive - Transactions says 'Account ID', Accounts says 'Account Id'", () => {
    expect(buildHeaderMap(TRANSACTIONS_HEADER_ROW).get("account id")).toBe(12)
    expect(buildHeaderMap(ACCOUNTS_HEADER_ROW).get("account id")).toBe(6)
  })

  test("survives an inserted column shifting every letter to its right", () => {
    const shifted = ["Date", "Merchant Name", "Description", "Amount"]
    const headerMap = buildHeaderMap(shifted)
    expect(headerMap.get("description")).toBe(2)
    expect(headerMap.get("amount")).toBe(3)
  })

  test("blank header cells are ignored, not stored as an empty-string key", () => {
    const headerMap = buildHeaderMap(TRANSACTIONS_HEADER_ROW)
    expect(headerMap.has("")).toBe(false)
  })
})

describe("parseTillerDate", () => {
  test("8/1/26 is August 1 2026, not 1926", () => {
    expect(parseTillerDate("8/1/26")).toBe("2026-08-01")
  })

  test("four-digit year", () => {
    expect(parseTillerDate("12/31/2026")).toBe("2026-12-31")
  })

  test("unparseable value throws", () => {
    expect(() => parseTillerDate("not a date")).toThrow()
  })
})

describe("mapTransactionRows", () => {
  const aliases: CategoryAliases = {
    knownDetailed: new Map([
      ["INCOME_SALARY", "INCOME"],
      ["LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT", "LOAN_DISBURSEMENTS"],
    ]),
    v1ToV2: new Map([
      ["INCOME_WAGES", "INCOME_SALARY"],
      ["TRANSFER_IN_CASH_ADVANCES_AND_LOANS", "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT"],
    ]),
  }

  function map(rows: string[][], windowStart = "2026-01-01") {
    return mapTransactionRows([TRANSACTIONS_HEADER_ROW, ...rows], {
      windowStart,
      knownDetailed: aliases.knownDetailed,
      v1ToV2: aliases.v1ToV2,
    })
  }

  test("skips rows where Source is not Plaid", () => {
    const row = rowFrom(TRANSACTIONS_HEADER_ROW, {
      Source: "Tiller",
      "Transaction ID": "txn_1",
      Date: "1/5/26",
    })
    const result = map([row])
    expect(result.transactions).toHaveLength(0)
  })

  test("skips rows with a blank Transaction ID", () => {
    const row = transactionRow({ "Transaction ID": "", Date: "1/5/26" })
    expect(map([row]).transactions).toHaveLength(0)
  })

  test("windowStart is inclusive at the boundary", () => {
    const onBoundary = transactionRow({
      "Transaction ID": "txn_boundary",
      "Account ID": "acc_1",
      Date: "1/5/26",
      Amount: "-$10.00",
      Description: "On the boundary",
    })
    const beforeBoundary = transactionRow({
      "Transaction ID": "txn_before",
      "Account ID": "acc_1",
      Date: "1/4/26",
      Amount: "-$10.00",
      Description: "Before the boundary",
    })
    const result = map([onBoundary, beforeBoundary], "2026-01-05")
    expect(result.transactions.map((transaction) => transaction.id)).toEqual(["txn_boundary"])
  })

  test("rowsRead counts every data row, kept or filtered", () => {
    const kept = transactionRow({
      "Transaction ID": "txn_1",
      "Account ID": "acc_1",
      Date: "1/5/26",
      Amount: "-$10.00",
    })
    const filtered = transactionRow({ Source: "Tiller", "Transaction ID": "txn_2", Date: "1/5/26" })
    expect(map([kept, filtered]).rowsRead).toBe(2)
  })

  test("maps a full row: date, sign-flipped amount, description fields", () => {
    const row = transactionRow({
      "Transaction ID": "txn_1",
      "Account ID": "acc_1",
      Date: "8/1/26",
      Amount: "-$3,463.68",
      Description: "Roundpoint Mtg Payments",
      "Full Description": "ROUNDPOINT MTG PAYMENTS",
      "Merchant Name": "Roundpoint Mortgage",
      "Check Number": "1234",
      "Date Added": "8/1/26",
    })
    const [transaction] = map([row]).transactions
    expect(transaction).toMatchObject({
      id: "txn_1",
      accountId: "acc_1",
      rawDate: "2026-08-01",
      rawAmount: "3463.68",
      rawDescription: "Roundpoint Mtg Payments",
      rawFullDescription: "ROUNDPOINT MTG PAYMENTS",
      rawMerchantName: "Roundpoint Mortgage",
      rawCheckNumber: "1234",
      rawImportedAt: "2026-08-01",
    })
  })

  test("a known v1 alias normalizes to v2 and carries its (unchanged) primary", () => {
    const row = transactionRow({
      "Transaction ID": "txn_1",
      "Account ID": "acc_1",
      Date: "1/5/26",
      Amount: "$10.00",
      "Category Hint": "INCOME: INCOME_WAGES",
    })
    const [transaction] = map([row]).transactions
    expect(transaction?.rawCategoryDetailed).toBe("INCOME_SALARY")
    expect(transaction?.rawCategoryPrimary).toBe("INCOME")
  })

  test("a v1 alias whose primary drifts resolves to the v2 primary, not the sheet's", () => {
    const row = transactionRow({
      "Transaction ID": "txn_1",
      "Account ID": "acc_1",
      Date: "1/5/26",
      Amount: "$10.00",
      "Category Hint": "TRANSFER_IN: TRANSFER_IN_CASH_ADVANCES_AND_LOANS",
    })
    const [transaction] = map([row]).transactions
    expect(transaction?.rawCategoryDetailed).toBe("LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT")
    expect(transaction?.rawCategoryPrimary).toBe("LOAN_DISBURSEMENTS")
  })

  test("a genuinely unknown code passes through as free text and is reported", () => {
    const row = transactionRow({
      "Transaction ID": "txn_1",
      "Account ID": "acc_1",
      Date: "1/5/26",
      Amount: "$10.00",
      "Category Hint": "SOME_NEW_PRIMARY: SOME_NEW_DETAILED",
    })
    const result = map([row])
    expect(result.transactions[0]?.rawCategoryDetailed).toBe("SOME_NEW_DETAILED")
    expect(result.transactions[0]?.rawCategoryPrimary).toBe("SOME_NEW_PRIMARY")
    expect(result.unknownCategories).toEqual(["SOME_NEW_DETAILED"])
  })

  test("a blank category hint maps to nulls, not an unknown-category report", () => {
    const row = transactionRow({
      "Transaction ID": "txn_1",
      "Account ID": "acc_1",
      Date: "1/5/26",
      Amount: "$10.00",
    })
    const result = map([row])
    expect(result.transactions[0]?.rawCategoryDetailed).toBeNull()
    expect(result.transactions[0]?.rawCategoryPrimary).toBeNull()
    expect(result.unknownCategories).toEqual([])
  })
})

describe("mapAccountRows", () => {
  test("resolves the duplicate 'Account' header to the hidden managed block", () => {
    const row = accountRow({
      "Account Id": "acc_1",
      Account: "Ultimate Rewards®",
      "Account #": "7614",
      Institution: "Chase",
      Type: "credit card",
      Class: "Liability",
      "Last Balance": "$1,234.56",
      "Last Update": "9/4/2026",
    })
    const [account] = mapAccountRows([ACCOUNTS_HEADER_ROW, row])
    expect(account).toMatchObject({
      id: "acc_1",
      rawName: "Ultimate Rewards®",
      rawMask: "7614",
      rawInstitution: "Chase",
      rawType: "credit",
      rawClass: "liability",
      rawBalance: "1234.56",
      rawBalanceAsOf: "2026-09-04",
    })
  })

  test("normalizes Type: 'credit card' -> credit, unrecognized -> other", () => {
    const creditCard = accountRow({ "Account Id": "acc_1", Type: "credit card" })
    const brokerage = accountRow({ "Account Id": "acc_2", Type: "brokerage" })
    const [first, second] = mapAccountRows([ACCOUNTS_HEADER_ROW, creditCard, brokerage])
    expect(first?.rawType).toBe("credit")
    expect(second?.rawType).toBe("other")
  })

  test("normalizes Class: 'Liability' -> liability, else asset", () => {
    const liability = accountRow({ "Account Id": "acc_1", Class: "Liability" })
    const asset = accountRow({ "Account Id": "acc_2", Class: "Asset" })
    const [first, second] = mapAccountRows([ACCOUNTS_HEADER_ROW, liability, asset])
    expect(first?.rawClass).toBe("liability")
    expect(second?.rawClass).toBe("asset")
  })

  test("Last Balance is not sign-flipped - a negative balance stays negative", () => {
    const row = accountRow({ "Account Id": "acc_1", "Last Balance": "-$500.00" })
    const [account] = mapAccountRows([ACCOUNTS_HEADER_ROW, row])
    expect(account?.rawBalance).toBe("-500.00")
  })

  test("a blank Last Balance maps to null, not a thrown error", () => {
    const row = accountRow({ "Account Id": "acc_1" })
    const [account] = mapAccountRows([ACCOUNTS_HEADER_ROW, row])
    expect(account?.rawBalance).toBeNull()
  })

  test("rows with a blank Account Id are skipped", () => {
    const row = accountRow({ Account: "No id" })
    expect(mapAccountRows([ACCOUNTS_HEADER_ROW, row])).toHaveLength(0)
  })
})
