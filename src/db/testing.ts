// PGlite harness for database tests — real Postgres, compiled to WASM, in
// memory. No network, no credentials, so this runs inside the pre-commit hook.
//
// Applies the committed migrations under drizzle/, not the schema object
// directly — that's what proves the migration produces the same
// resolved_transactions view that reaches Neon, not just that the schema
// module is internally consistent.

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as schema from "./schema"

export async function createTestDatabase() {
  const client = new PGlite()
  const database = drizzle(client, { schema })
  await migrate(database, { migrationsFolder: "./drizzle" })
  return database
}
