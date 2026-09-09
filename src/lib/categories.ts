// GET /categories. The Plaid PFC v2 taxonomy, grouped by primary. No
// precedence rule here - categories are a static seed (db/seeds/categories.ts),
// not a raw/ai/ugc column set - so this reads the base table directly.

import type { Database } from "../db/client"
import { categories } from "../db/schema"

export interface CategoryRow {
  detailed: string
  primary: string
  description: string | null
  iconUrl: string | null
}

export interface CategoryLeaf {
  detailed: string
  description: string | null
}

export interface CategoryGroup {
  primary: string
  iconUrl: string | null
  detailed: CategoryLeaf[]
}

// Single forward pass that opens a new group whenever `primary` changes -
// correct only because the caller orders rows by primary first. Pure and
// unit-tested on its own; the orderBy in listCategories below is load-bearing,
// not cosmetic - drop it and groups silently fragment.
export function groupByPrimary(rows: CategoryRow[]): CategoryGroup[] {
  const groups: CategoryGroup[] = []
  let currentGroup: CategoryGroup | undefined

  for (const row of rows) {
    if (currentGroup === undefined || currentGroup.primary !== row.primary) {
      // iconUrl is derived once per primary (lib/pfc.ts), so every row in a
      // group carries the same value - first-non-null is exact, and degrades
      // sanely if a future row ever lands without one.
      currentGroup = { primary: row.primary, iconUrl: row.iconUrl, detailed: [] }
      groups.push(currentGroup)
    } else if (currentGroup.iconUrl === null && row.iconUrl !== null) {
      currentGroup.iconUrl = row.iconUrl
    }
    currentGroup.detailed.push({ detailed: row.detailed, description: row.description })
  }

  return groups
}

export async function listCategories(database: Database) {
  const rows = await database
    .select({
      detailed: categories.detailed,
      // Drizzle's column reference quotes the identifier, sidestepping
      // `primary` being a Postgres keyword - the same trap
      // db/seeds/categories.ts had to quote around in raw SQL.
      primary: categories.primary,
      description: categories.description,
      iconUrl: categories.iconUrl,
    })
    .from(categories)
    .orderBy(categories.primary, categories.detailed)

  return { categories: groupByPrimary(rows) }
}

export type CategoryList = Awaited<ReturnType<typeof listCategories>>
