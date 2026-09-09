// GET /categories. The Plaid PFC v2 taxonomy, grouped by primary. No
// precedence rule here - categories are a static seed (db/seeds/categories.ts),
// not a raw/ai/ugc column set - so this reads the base table directly.

import type { Database } from "../db/client"
import { categories } from "../db/schema"

export interface CategoryRow {
  detailed: string
  name: string
  primary: string
  primaryName: string
}

export interface CategoryLeaf {
  id: string
  name: string
}

export interface CategoryGroup {
  primary: { id: string; name: string }
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
    if (currentGroup === undefined || currentGroup.primary.id !== row.primary) {
      currentGroup = { primary: { id: row.primary, name: row.primaryName }, detailed: [] }
      groups.push(currentGroup)
    }
    currentGroup.detailed.push({ id: row.detailed, name: row.name })
  }

  return groups
}

export async function listCategories(database: Database) {
  const rows = await database
    .select({
      detailed: categories.detailed,
      name: categories.name,
      // Drizzle's column reference quotes the identifier, sidestepping
      // `primary` being a Postgres keyword - the same trap
      // db/seeds/categories.ts had to quote around in raw SQL.
      primary: categories.primary,
      primaryName: categories.primaryName,
    })
    .from(categories)
    .orderBy(categories.primary, categories.detailed)

  return { categories: groupByPrimary(rows) }
}

export type CategoryList = Awaited<ReturnType<typeof listCategories>>
