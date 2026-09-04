// Usage: bun run db:seed (reads DATABASE_URL from .env.local)
// Safe to re-run: both seeds upsert.

import { createDatabaseClient } from "../client"
import { seedCategories } from "./categories"
import { seedSystemBudget } from "./system-budget"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not set")

const database = createDatabaseClient(databaseUrl)

const categoryCount = await seedCategories(database)
console.log(`Seeded ${categoryCount} categories.`)

await seedSystemBudget(database)
console.log("Seeded the Unassigned system budget.")

// neon-serverless holds real sockets open - without this the script prints
// its output and then hangs instead of returning to the shell.
await database.$client.end()
