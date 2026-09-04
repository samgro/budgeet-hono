import { createApp } from "./app"
import { createDatabaseClient } from "./db/client"

const apiToken = process.env.API_TOKEN
if (!apiToken) throw new Error("API_TOKEN is not set")

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not set")

// No route wires this in yet - that lands with the sync route (BUD-4). Built
// here so the pool's lifecycle is tied to the process from the start, rather
// than bolted on later once something depends on it.
const database = createDatabaseClient(databaseUrl)

const app = createApp(apiToken)

// The pool holds real sockets open. Drain them on the signals Railway sends
// before killing the process, so a restart or redeploy doesn't leak
// connections against Neon's limit.
async function shutdown() {
  await database.$client.end()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
}
