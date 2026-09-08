import { Hono } from "hono"
import type { DatabaseClient } from "./db/client"
import { errorResponse } from "./lib/errors"
import type { SheetsClient } from "./lib/sheets"
import { bearerAuth } from "./middleware/auth"
import { health } from "./routes/health"
import { createSyncRoute } from "./routes/sync"

// Takes the token and its dependencies as arguments rather than reading
// process.env or constructing clients itself, so tests can construct a real
// app against a known token and a fake sheets client without touching the
// environment or the network.
export function createApp(apiToken: string, database: DatabaseClient, sheetsClient: SheetsClient) {
  const app = new Hono()

  // Spec §5: every route requires the bearer token, /health included.
  app.use("*", bearerAuth(apiToken))

  app.route("/health", health)
  app.route("/sync", createSyncRoute(database, sheetsClient))

  app.notFound((context) => errorResponse(context, "NOT_FOUND", "No such route", 404))

  app.onError((error, context) => {
    console.error(error)
    return errorResponse(context, "INTERNAL", "Something went wrong", 500)
  })

  return app
}
