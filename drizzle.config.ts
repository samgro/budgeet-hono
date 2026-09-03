import { existsSync, readFileSync } from "node:fs"
import { defineConfig } from "drizzle-kit"

// drizzle-kit's own dotenv support only auto-loads `.env`, not `.env.local`,
// and this repo has no `.env` — see CLAUDE.md/.gitignore. Load it explicitly
// so `db:generate`/`db:push`/`db:migrate` work the same regardless of whether
// drizzle-kit ends up running under Bun or Node (invocation-dependent, and not
// worth relying on): only fills in values not already set in the environment.
function loadEnvLocal() {
  const envPath = ".env.local"
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith("#")) continue

    const equalsIndex = trimmedLine.indexOf("=")
    if (equalsIndex === -1) continue

    const key = trimmedLine.slice(0, equalsIndex).trim()
    const value = trimmedLine.slice(equalsIndex + 1).trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvLocal()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is not set")

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
})
