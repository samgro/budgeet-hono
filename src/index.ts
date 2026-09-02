import { createApp } from "./app"

const apiToken = process.env.API_TOKEN
if (!apiToken) throw new Error("API_TOKEN is not set")

const app = createApp(apiToken)

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
}
