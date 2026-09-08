// Thin, per CLAUDE.md — validation and response shaping only. Query parsing,
// the keyset predicate, and the resolved_transactions joins all live in
// lib/transactions.ts; this route exists to turn HTTP into a listTransactions
// / getTransaction call and back into HTTP.

import { Hono } from "hono"
import type { Database } from "../db/client"
import { InvalidCursorError } from "../lib/cursor"
import { errorResponse } from "../lib/errors"
import {
  getTransaction,
  InvalidTransactionQueryError,
  listTransactions,
  parseTransactionQuery,
} from "../lib/transactions"

export function createTransactionsRoute(database: Database) {
  const transactions = new Hono()

  transactions.get("/", async (context) => {
    let query: ReturnType<typeof parseTransactionQuery>
    try {
      query = parseTransactionQuery(context.req.query())
    } catch (error) {
      if (error instanceof InvalidTransactionQueryError || error instanceof InvalidCursorError) {
        return errorResponse(context, "BAD_REQUEST", error.message, 400)
      }
      throw error
    }

    return context.json(await listTransactions(database, query))
  })

  transactions.get("/:id", async (context) => {
    const transaction = await getTransaction(database, context.req.param("id"))
    if (transaction === null) {
      return errorResponse(context, "NOT_FOUND", "No such transaction", 404)
    }
    return context.json(transaction)
  })

  return transactions
}
