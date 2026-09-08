import { createApp } from "./app"
import { createDatabaseClient } from "./db/client"
import { createSheetsClient, decodeServiceAccount } from "./lib/sheets"

const apiToken = process.env.API_TOKEN
if (!apiToken) throw new Error("API_TOKEN is not set")

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not set")

const serviceAccountBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
if (!serviceAccountBase64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set")

const sheetId = process.env.TILLER_SHEET_ID
if (!sheetId) throw new Error("TILLER_SHEET_ID is not set")

// Built here, once, so the pool's lifecycle is tied to the process rather
// than to any one request.
const database = createDatabaseClient(databaseUrl)
const sheetsClient = createSheetsClient({
  credentials: decodeServiceAccount(serviceAccountBase64),
  sheetId,
})

const app = createApp(apiToken, database, sheetsClient)

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
