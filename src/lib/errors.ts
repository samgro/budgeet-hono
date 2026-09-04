// The one place `{ error: { code, message } }` gets written. Every route and
// every middleware goes through this — never hand-roll the shape inline.

import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export type ErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "INTERNAL"
  // A dependency we don't control failed - Google Sheets auth/quota/outage,
  // eventually Claude. Distinct from INTERNAL so a transient upstream
  // problem doesn't get reported as our bug.
  | "UPSTREAM"

export interface ErrorBody {
  error: { code: ErrorCode; message: string }
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } }
}

// Route/middleware convenience over the pure builder above — not itself unit
// tested, since it's a one-line wrapper around context.json().
export function errorResponse(
  context: Context,
  code: ErrorCode,
  message: string,
  status: ContentfulStatusCode,
) {
  return context.json(errorBody(code, message), status)
}
