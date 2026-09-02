// The one place `{ error: { code, message } }` gets written. Every route and
// every middleware goes through this — never hand-roll the shape inline.

import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export type ErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "INTERNAL"

export interface ErrorBody {
  error: { code: ErrorCode; message: string }
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } }
}

// Route/middleware convenience over the pure builder above — not itself unit
// tested, since it's a one-line wrapper around c.json().
export function errorResponse(
  c: Context,
  code: ErrorCode,
  message: string,
  status: ContentfulStatusCode,
) {
  return c.json(errorBody(code, message), status)
}
