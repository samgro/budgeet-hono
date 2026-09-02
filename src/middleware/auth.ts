// Constant-time bearer auth. Spec §6: `===` on a secret leaks its length and
// prefix through timing — one line (the length check before timingSafeEqual)
// to not do that.

import { timingSafeEqual } from "node:crypto"
import type { Context, MiddlewareHandler } from "hono"
import { errorResponse } from "../lib/errors"

function unauthorized(context: Context) {
  return errorResponse(context, "UNAUTHORIZED", "Bad or missing token", 401)
}

// Factory, not a module-level env read — callers (and tests) pass the
// expected token explicitly, so this never reaches into process.env itself.
export function bearerAuth(expected: string): MiddlewareHandler {
  const want = Buffer.from(expected)
  return async (context, next) => {
    const header = context.req.header("authorization") ?? ""
    if (!header.startsWith("Bearer ")) return unauthorized(context)

    const got = Buffer.from(header.slice(7))
    // timingSafeEqual throws on mismatched lengths rather than returning
    // false — check length first or a short token 500s instead of 401ing.
    if (got.length !== want.length || !timingSafeEqual(got, want)) return unauthorized(context)

    await next()
  }
}
