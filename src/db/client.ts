// Factory, not a module-level env read — same shape as createApp(apiToken) in
// src/app.ts. src/index.ts stays the only file that reads process.env, so
// tests and seed scripts pass a connection string explicitly.

import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema"

export function createDatabaseClient(connectionString: string) {
  return drizzle(neon(connectionString), { schema })
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>
