// Extended in SDG-197 with lastSyncAt, lastSyncStatus, unclassifiedCount
// once the schema (SDG-172) exists.

import { Hono } from "hono"

export const health = new Hono()

health.get("/", (c) => c.json({ ok: true }))
