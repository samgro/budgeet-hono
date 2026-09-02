import { Hono } from "hono"
import { errorResponse } from "./lib/errors"
import { bearerAuth } from "./middleware/auth"
import { health } from "./routes/health"

// Takes the token as an argument rather than reading process.env itself, so
// tests can construct a real app against a known token without touching the
// environment.
export function createApp(apiToken: string) {
  const app = new Hono()

  // Spec §5: every route requires the bearer token, /health included.
  app.use("*", bearerAuth(apiToken))

  app.route("/health", health)

  app.notFound((c) => errorResponse(c, "NOT_FOUND", "No such route", 404))

  app.onError((err, c) => {
    console.error(err)
    return errorResponse(c, "INTERNAL", "Something went wrong", 500)
  })

  return app
}
