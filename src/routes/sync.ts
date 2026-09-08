// Thin, per CLAUDE.md — validation and response shaping only. Guards, the
// upserts, and the raw-only invariant all live in lib/sync.ts; this route
// exists to turn HTTP into a runSync call and a runSync result back into HTTP.

import { Hono } from "hono"
import type { DatabaseClient } from "../db/client"
import { withPinnedConnection } from "../db/client"
import { errorResponse } from "../lib/errors"
import type { SheetsClient } from "../lib/sheets"
import { SheetsError } from "../lib/sheets"
import { InvalidWindowStartError, resolveWindowStart, runSync } from "../lib/sync"

export function createSyncRoute(database: DatabaseClient, sheetsClient: SheetsClient) {
  const sync = new Hono()

  sync.post("/", async (context) => {
    let windowStart: string
    try {
      windowStart = resolveWindowStart(context.req.query("since"))
    } catch (error) {
      if (error instanceof InvalidWindowStartError) {
        return errorResponse(context, "BAD_REQUEST", error.message, 400)
      }
      throw error
    }

    const force = context.req.query("force") === "true"

    try {
      // Pinning happens here, not inside runSync — the advisory lock is
      // session-scoped and must survive the whole run, Google fetch included.
      const result = await withPinnedConnection(database, (pinned) =>
        runSync(pinned, sheetsClient, { windowStart, force }),
      )
      return context.json(result)
    } catch (error) {
      // runSync already records the failure on the sync_runs row itself —
      // this is only about telling the caller, never swallowing into
      // console.error (a genuinely unexpected error still falls through to
      // app.onError, which logs and returns INTERNAL).
      if (error instanceof SheetsError) {
        return errorResponse(context, "UPSTREAM", error.message, 502)
      }
      throw error
    }
  })

  return sync
}
