// The one mandatory budget: orphaned transactions (deleted budget, or never
// classified) land here. Delete-protection is enforced in the Write API epic,
// not here - this just guarantees the row exists.

import type { DatabaseClient } from "../client"
import { budgets } from "../schema"

export async function seedSystemBudget(database: DatabaseClient) {
  await database
    .insert(budgets)
    .values({
      id: "unassigned",
      name: "Unassigned",
      class: "excluded",
      isSystem: true,
      sortOrder: 999,
    })
    .onConflictDoNothing()
}
