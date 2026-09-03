// Idempotent upsert of the Plaid PFC v2 taxonomy, from the committed CSV -
// re-run safe, and re-running it after a taxonomy refresh updates existing
// rows rather than leaving them stale. See src/lib/pfc.ts for the parsing
// (including the PFC v1 aliases) and CLAUDE.md for why those aliases exist.

import { sql } from "drizzle-orm"
import { parsePfcTaxonomy } from "../../lib/pfc"
import type { DatabaseClient } from "../client"
import { categories } from "../schema"

const csvPath = new URL("./pfc-taxonomy-all.csv", import.meta.url)

export async function seedCategories(database: DatabaseClient) {
  const csvText = await Bun.file(csvPath).text()
  const parsedCategories = parsePfcTaxonomy(csvText)

  await database
    .insert(categories)
    .values(parsedCategories)
    .onConflictDoUpdate({
      target: categories.detailed,
      set: {
        // "primary" is a Postgres unreserved keyword when used as an
        // identifier - quote it so `excluded.primary` can't be misparsed.
        primary: sql`excluded."primary"`,
        description: sql`excluded.description`,
        iconUrl: sql`excluded.icon_url`,
        pfcv1Detailed: sql`excluded.pfcv1_detailed`,
      },
    })

  return parsedCategories.length
}
