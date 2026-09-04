// Factory, not a module-level env read — same shape as createApp(apiToken) in
// src/app.ts. src/index.ts stays the only file that reads process.env, so
// tests and seed scripts pass a connection string explicitly.
//
// neon-serverless, not neon-http: every neon-http query is a separate HTTPS
// request with no session, so a session-scoped construct (an advisory lock,
// an interactive transaction) is acquired and released before the next
// statement ever runs. Sync's concurrency guard and the write API's
// correction logging both need a real session. The WebSocket transport
// works here with no polyfill — Bun implements the global WebSocket the
// driver falls back to when webSocketConstructor is left unset.

import { Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import * as schema from "./schema"

export function createDatabaseClient(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema })
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>

// Any Drizzle Postgres database over this schema — the Neon pool in
// production, PGlite in tests (src/db/testing.ts). Functions that do real
// work (ingest, classification) should take this instead of DatabaseClient,
// so the same code path is exercised against both.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

// A session advisory lock, and similar session-scoped work, needs one
// connection held across other awaits — including a network call out to
// Google Sheets. Pin a connection rather than opening a transaction: an idle
// transaction held open across an HTTP round trip is how you get connection
// pileups against the pool.
export async function withPinnedConnection<Result>(
  database: DatabaseClient,
  callback: (pinned: Database) => Promise<Result>,
): Promise<Result> {
  const connection = await database.$client.connect()
  try {
    return await callback(drizzle(connection, { schema }))
  } finally {
    connection.release()
  }
}
