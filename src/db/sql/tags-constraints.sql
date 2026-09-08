-- Regenerate-safety net for uq_tags_id_kind and the two composite FKs that
-- target it (SDG-209). These ARE declared normally in src/db/schema.ts -
-- this file is not applied anywhere in the normal flow. It exists purely
-- because `bunx drizzle-kit push` cannot be trusted to manage this specific
-- constraint (see the comment on tags' `foreignKey({ columns: [parentId,
-- kind], ... })` in schema.ts for the full explanation: a confirmed
-- drizzle-kit 0.31.10 bug where a composite unique constraint targeted by
-- more than one FK is always reported as changed, and the DROP it generates
-- isn't ordered after its dependents).
--
-- If `drizzle/` is ever squashed again (`rm -rf drizzle/ && drizzle-kit
-- generate`), the fresh output WILL include these statements correctly,
-- because `generate` builds a CREATE-only migration from a database-shaped
-- schema.ts and never hits the buggy incremental-diff code path that `push`
-- does. Nothing needs to be copied from here in that case. Keep this file
-- only as a reference for what the constraints are and why they're fragile
-- under `push`, and update it if their definitions ever change.

ALTER TABLE "tags" ADD CONSTRAINT "uq_tags_id_kind" UNIQUE ("id", "kind");

ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_kind_tags_id_kind_fk"
  FOREIGN KEY ("parent_id", "kind") REFERENCES "tags"("id", "kind");

ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_kind_tags_id_kind_fk"
  FOREIGN KEY ("tag_id", "kind") REFERENCES "tags"("id", "kind") ON DELETE CASCADE;
