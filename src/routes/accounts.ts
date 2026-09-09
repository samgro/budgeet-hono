// Thin, per CLAUDE.md — validation and response shaping only. Query parsing
// and the resolved_accounts read both live in lib/accounts.ts; this route
// exists to turn HTTP into a listAccounts call and back into HTTP.

import { Hono } from "hono"
import type { Database } from "../db/client"
import {
  type AccountQuery,
  InvalidAccountQueryError,
  listAccounts,
  parseAccountQuery,
} from "../lib/accounts"
import { errorResponse } from "../lib/errors"

export function createAccountsRoute(database: Database) {
  const accounts = new Hono()

  accounts.get("/", async (context) => {
    let query: AccountQuery
    try {
      query = parseAccountQuery(context.req.query())
    } catch (error) {
      if (error instanceof InvalidAccountQueryError) {
        return errorResponse(context, "BAD_REQUEST", error.message, 400)
      }
      throw error
    }

    return context.json(await listAccounts(database, query))
  })

  return accounts
}
