// Keyset pagination cursor for GET /transactions - (date desc, id desc).
//
// Encoded as base64url over a JSON object, not a delimited string: id is an
// opaque Tiller value whose alphabet we don't control, so a delimiter scheme
// would need its own escaping rule. JSON already has one. base64url (not
// base64) keeps +, /, and = out of the query string, so it never needs
// percent-encoding.

import { isIsoDate } from "./dates"

export interface Cursor {
  date: string
  id: string
}

export class InvalidCursorError extends Error {}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeCursor(value: string): Cursor {
  // Buffer.from(..., "base64url") does not throw on garbage input - it
  // silently returns a truncated buffer - so every check below has to run
  // against the decoded value, not the decode call itself.
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    throw new InvalidCursorError("cursor is not a valid pagination token")
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidCursorError("cursor is not a valid pagination token")
  }

  const { date, id } = parsed as Record<string, unknown>

  if (typeof date !== "string" || !isIsoDate(date)) {
    throw new InvalidCursorError("cursor is not a valid pagination token")
  }
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidCursorError("cursor is not a valid pagination token")
  }

  // Rebuilt from just the two known fields, so a cursor minted by a future
  // version with extra fields degrades gracefully instead of 400ing.
  return { date, id }
}
