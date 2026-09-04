// Service-account auth and one batched read of the Tiller Google Sheet.
// The network call itself isn't unit tested — src/scripts/sheet-peek.ts is
// how this gets validated, against the real sheet. decodeServiceAccount and
// classifySheetsError are pure and are the test surface.

import { google } from "googleapis"

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
const TRANSACTIONS_RANGE = "Transactions!A:AA"
const ACCOUNTS_RANGE = "Accounts!A:R"

export interface SheetsCredentials {
  client_email: string
  private_key: string
  [key: string]: unknown
}

// GOOGLE_SERVICE_ACCOUNT_JSON is base64-encoded - Railway env vars and the
// raw newlines inside a PEM private key don't mix. Decode before handing it
// to the auth library.
export function decodeServiceAccount(base64: string): SheetsCredentials {
  const json = Buffer.from(base64, "base64").toString("utf-8")
  const credentials = JSON.parse(json)
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error("Service account JSON is missing client_email or private_key")
  }
  return credentials
}

export type SheetsErrorKind = "auth" | "quota" | "unavailable"

// A typed failure instead of a thrown string, per SDG-189 - the caller
// (eventually the sync route) needs to tell "your credentials are wrong"
// apart from "you've hit the 300 reads/min/project quota" apart from
// "Google is down right now."
export class SheetsError extends Error {
  readonly kind: SheetsErrorKind

  constructor(kind: SheetsErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SheetsError"
    this.kind = kind
  }
}

// Duck-typed rather than importing gaxios's GaxiosError directly - googleapis
// vendors its own copy of gaxios, and pinning to the wrong instance of the
// class would make `instanceof` fail silently and every error fall through
// to "unavailable".
function extractStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const direct = (error as { status?: unknown }).status
  if (typeof direct === "number") return direct
  const nested = (error as { response?: { status?: unknown } }).response?.status
  return typeof nested === "number" ? nested : undefined
}

export function classifySheetsError(error: unknown): SheetsError {
  const status = extractStatus(error)
  const message = error instanceof Error ? error.message : String(error)

  if (status === 401 || status === 403) {
    return new SheetsError("auth", `Google Sheets auth failed: ${message}`, { cause: error })
  }
  if (status === 429) {
    return new SheetsError("quota", `Google Sheets quota exceeded: ${message}`, { cause: error })
  }
  return new SheetsError("unavailable", `Google Sheets request failed: ${message}`, {
    cause: error,
  })
}

export interface TillerSheetsPayload {
  transactionRows: string[][]
  accountRows: string[][]
}

export interface SheetsClient {
  fetchTillerSheets(): Promise<TillerSheetsPayload>
}

// The default valueRenderOption (FORMATTED_VALUE) returns display strings for
// every cell - "8/1/26", "$1,234.56" - which is exactly what tiller-map's
// transforms (SDG-190) expect. Left unset deliberately; don't add
// valueRenderOption without re-checking that assumption.
function normalizeRows(rows: unknown[][] | null | undefined): string[][] {
  return (rows ?? []).map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  )
}

export function createSheetsClient(options: {
  credentials: SheetsCredentials
  sheetId: string
}): SheetsClient {
  const auth = new google.auth.GoogleAuth({
    credentials: options.credentials,
    scopes: [SHEETS_READONLY_SCOPE],
  })
  const sheets = google.sheets({ version: "v4", auth })

  return {
    async fetchTillerSheets() {
      try {
        // One batchGet for both tabs - not one request per tab. Quota is
        // 300 reads/min/project, and /sync now runs on page load.
        const result = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: options.sheetId,
          ranges: [TRANSACTIONS_RANGE, ACCOUNTS_RANGE],
        })
        const [transactionRange, accountRange] = result.data.valueRanges ?? []
        return {
          transactionRows: normalizeRows(transactionRange?.values),
          accountRows: normalizeRows(accountRange?.values),
        }
      } catch (error) {
        throw classifySheetsError(error)
      }
    },
  }
}
