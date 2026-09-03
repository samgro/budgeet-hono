# Budgeet v1 — Tiller Stopgap

Single-user, bearer-token finance API. Bun + Hono + Drizzle + Neon on Railway.
Data source is the Tiller Google Sheet until Plaid production access lands.

---

## 1. Field audit — what in the sheet is actually Plaid

Every account in the sheet reports `Source = Plaid`, so the aggregator payload is Plaid PFC v2.

### Transactions sheet

| Column | Origin | v1 |
|---|---|---|
| `Transaction ID` | Tiller-assigned, stable, unique | ✅ primary key |
| `Account ID` | Tiller-assigned (24-hex), stable | ✅ foreign key |
| `Date` | Plaid posted date | ✅ `raw_date` |
| `Amount` | Plaid `amount`, **sign inverted** | ✅ `raw_amount` (× −1 on import) |
| `Description` | Plaid `name` (lightly cleaned) | ✅ `raw_description` |
| `Full Description` | Plaid `original_description` | ✅ `raw_full_description` |
| `Merchant Name` | Plaid `merchant_name` | ✅ `raw_merchant_name` |
| `Category Hint` | Plaid PFC v2, `"PRIMARY: PRIMARY_DETAILED"` | ✅ split into two columns |
| `Check Number` | Plaid `check_number` | ✅ sparse but free |
| `Account`, `Account #`, `Institution` | Plaid account metadata | ✅ but on `accounts`, not per-row |
| `Source` | Tiller provenance | ✅ ingest filter only |
| `Date Added` | Tiller | ✅ `raw_imported_at` |
| `Category`, `Tag`, `Notes` | Tiller/AutoCat inference and sheet workflow | ❌ |
| `Month`, `Week` | sheet formulas | ❌ derive in SQL |
| `Review`, `Categorized By`, `Categorized Date`, `Import Tag` | spreadsheet workflow | ❌ |

### Accounts sheet

Keep `Account Id`, `Account`, `Account #`, `Institution`, `Type`, `Class`, `Last Balance`, `Last Update`, `Hide`.
Drop `Class Override`, `Group`, `Unique Account Identifier`, and the duplicated display columns.

Ignore **Categories**, **Balance History**, **AutoCat**, **Tags**, **Monthly/Yearly Budget**,
**Spending Trends**, and **tiller_settings** entirely.

### Three things the sheet reveals that will bite you

1. **Tiller emits PFC v1, not v2.** Live rows carry `INCOME_WAGES` and `TRANSFER_IN_CASH_ADVANCES_AND_LOANS` —
   not stale-seed gaps, but PFC **v1** category codes (Plaid's taxonomy CSV confirms it: existing Plaid
   customers as of December 2025 default to v1). This schema stores v2, which the seed is correct against.
   The mapping is well-behaved — 105 of 127 v2 codes name a v1 counterpart, and 101 of those are
   byte-identical strings — so `categories.pfcv1_detailed` (a text array; `OTHER_OTHER` has two v1 aliases)
   carries it, and sync normalizes v1 → v2 on the way in.
   → `raw_category_detailed` must **still** not carry a foreign key: normalization only covers codes the
   taxonomy CSV knows about. Store it as free text and report genuinely unknown codes on the sync run.
   Only `ugc_category_detailed` is FK-constrained.
2. **Plaid's hints are wrong often enough to matter.** `AUTOMATIC PAYMENT - THANK` (a $855.41 credit-card
   payment) is tagged `INCOME: INCOME_WAGES`. Treat the hint as a prior, never a fact.
3. **Tiller has no `pending` concept.** It only writes reconciled transactions. The widget spec assumes
   pending rows are included; under Tiller that's unavailable, so the widget runs ~1–2 days behind.
   Surface it via `asOf` and revisit at Plaid cutover.

---

## 2. Column prefix convention

Three provenances, three prefixes, no exceptions:

| Prefix | Owner | Written by | Overwritten by sync |
|---|---|---|---|
| `raw_` | the bank, via Plaid → Tiller | `POST /sync` | yes, every run |
| `ai_` | Claude | `POST /classify` | no |
| `ugc_` | you | `PATCH` routes | never |

Read paths resolve `COALESCE(ugc_x, ai_x, raw_x)` — user beats model beats bank. That precedence lives in
one view (§4), not in route handlers.

Join tables can't carry a prefix, so `transaction_tags` uses a `source: 'ai' | 'ugc'` column instead.
Same semantics, same precedence.

---

## 3. Tables

| Table | Role |
|---|---|
| `accounts` | Tiller/Plaid accounts |
| `transactions` | core; raw / ai / ugc columns side by side |
| `categories` | Plaid PFC v2 seed, ~127 rows |
| `budgets` | spend buckets, `class` drives the widget |
| `trips` | date-bounded travel windows |
| `tags` | free-form labels — divorce, cat, work |
| `transaction_tags` | many-to-many join, `source`-stamped |
| `subscriptions` | recurring merchant + expected amount |
| `corrections` | append-only log of every ai → ugc override |
| `sync_runs` | freshness signal + debuggability |
| `app_state` | KV: distilled classification guide |
| `v_transactions` | view resolving the three-way COALESCE |

`corrections` is the one that's easy to skip and shouldn't be. `ugc_budget_id` tells you the *current*
state; it doesn't tell you that on Aug 12 you moved Safeway out of Groceries into a trip because you were
in Melbourne. That transition is the training signal, and it has to be append-only or the next edit
overwrites it.

---

## 4. Schema

Amounts follow **Plaid convention: positive = outflow**. Tiller is the opposite, so `× −1` at ingest.
This keeps the schema correct on the day you cut over to real Plaid.

```ts
import { pgTable, pgEnum, text, date, numeric, boolean, integer, real,
         timestamp, jsonb, index, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const accountType = pgEnum("account_type",
  ["checking", "savings", "credit", "investment", "loan", "other"])
export const accountClass = pgEnum("account_class", ["asset", "liability"])
export const budgetClass = pgEnum("budget_class",
  ["fixed", "essential", "discretionary", "income", "excluded"])
export const cadence = pgEnum("cadence",
  ["weekly", "monthly", "quarterly", "yearly"])
export const attribution = pgEnum("attribution", ["ai", "ugc"])
export const correctionField = pgEnum("correction_field",
  ["budget", "category", "description", "amount", "trip", "tag", "subscription"])
export const syncStatus = pgEnum("sync_status", ["running", "ok", "error"])

// ── accounts ────────────────────────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),                        // Tiller Account ID
  rawName: text("raw_name").notNull(),                // "Ultimate Rewards®"
  rawMask: text("raw_mask"),                          // "7614"
  rawInstitution: text("raw_institution").notNull(),  // "Chase"
  rawType: accountType("raw_type").notNull(),
  rawClass: accountClass("raw_class").notNull(),
  rawBalance: numeric("raw_balance", { precision: 14, scale: 2 }),
  rawBalanceAsOf: timestamp("raw_balance_as_of", { withTimezone: true }),
  ugcName: text("ugc_name"),                          // display override
  ugcIsHidden: boolean("ugc_is_hidden").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── categories (Plaid PFC v2 seed) ──────────────────────────────────────
export const categories = pgTable("categories", {
  detailed: text("detailed").primaryKey(),            // FOOD_AND_DRINK_GROCERIES
  primary: text("primary").notNull(),                 // FOOD_AND_DRINK
  description: text("description"),
  iconUrl: text("icon_url"),
}, (t) => [index("idx_categories_primary").on(t.primary)])

// ── budgets ─────────────────────────────────────────────────────────────
export const budgets = pgTable("budgets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Natural-language rule Claude reads. The richer this is, the better it classifies.
  description: text("description"),
  // Drives the widget: only `discretionary` rolls into the hero figure;
  // `essential` gets a right-column row; `excluded` never appears.
  class: budgetClass("class").notNull(),
  targetAmount: numeric("target_amount", { precision: 14, scale: 2 }), // per month
  linkedCategories: jsonb("linked_categories").$type<string[]>().default([]).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  // Exactly one system budget: the mandatory "Unassigned" catch-all. Cannot be deleted.
  isSystem: boolean("is_system").default(false).notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── trips ───────────────────────────────────────────────────────────────
// A date window is a *candidate* filter, not an assignment: the mortgage that
// autopays mid-trip is not trip spend. Claude decides inside the window.
export const trips = pgTable("trips", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),                       // "AU/NZ Trip"
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  // Optional hints for Claude: destinations, who came, what counts.
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_trips_range").on(t.startDate, t.endDate)])

// ── tags ────────────────────────────────────────────────────────────────
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),              // "divorce", "cat"
  // Natural-language rule, same job as budgets.description.
  // "Anything for Pixel — vet, food, litter, boarding."
  description: text("description"),
  color: text("color"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const transactionTags = pgTable("transaction_tags", {
  transactionId: text("transaction_id").notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  source: attribution("source").notNull(),
  aiConfidence: real("ai_confidence"),                // null when source = 'ugc'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.transactionId, t.tagId] }),
  index("idx_txn_tags_tag").on(t.tagId),
])

// ── subscriptions ───────────────────────────────────────────────────────
// Doubles as a deterministic pre-filter: merchant match + amount within tolerance
// assigns the budget with no API call at all.
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),                       // "Netflix"
  // Matched case-insensitively against raw_merchant_name, then raw_description.
  merchantPattern: text("merchant_pattern").notNull(),
  expectedAmount: numeric("expected_amount", { precision: 14, scale: 2 }),
  // Absolute dollars. Outside tolerance → still linked, but flagged as a price change.
  amountTolerance: numeric("amount_tolerance", { precision: 14, scale: 2 })
    .default("2.00").notNull(),
  cadence: cadence("cadence").default("monthly").notNull(),
  // Default budget for matching transactions.
  budgetId: text("budget_id").references(() => budgets.id, { onDelete: "set null" }),
  source: attribution("source").default("ugc").notNull(), // 'ai' = Claude spotted the pattern
  isActive: boolean("is_active").default(true).notNull(),
  cancelledAt: date("cancelled_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── transactions ────────────────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),                        // Tiller Transaction ID
  accountId: text("account_id").notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),

  // ---- raw: owned by the sync, overwritten every run ----
  rawDate: date("raw_date").notNull(),
  rawAmount: numeric("raw_amount", { precision: 14, scale: 2 }).notNull(),
  rawDescription: text("raw_description").notNull(),
  rawFullDescription: text("raw_full_description"),
  rawMerchantName: text("raw_merchant_name"),
  rawCategoryPrimary: text("raw_category_primary"),
  // Deliberately NOT an FK — Plaid emits codes ahead of our seed. See §1.
  rawCategoryDetailed: text("raw_category_detailed"),
  rawCheckNumber: text("raw_check_number"),
  rawImportedAt: date("raw_imported_at"),             // Tiller "Date Added"

  // ---- ai: written by /classify, never by /sync ----
  aiBudgetId: text("ai_budget_id").references(() => budgets.id, { onDelete: "set null" }),
  aiTripId: text("ai_trip_id").references(() => trips.id, { onDelete: "set null" }),
  aiSubscriptionId: text("ai_subscription_id")
    .references(() => subscriptions.id, { onDelete: "set null" }),
  aiCategoryDetailed: text("ai_category_detailed").references(() => categories.detailed),
  aiConfidence: real("ai_confidence"),
  aiModel: text("ai_model"),                          // "claude-haiku-4-5-20251001"
  aiReasoning: text("ai_reasoning"),                  // one line, for the correction UI
  aiClassifiedAt: timestamp("ai_classified_at", { withTimezone: true }),

  // ---- ugc: owned by you, never touched by anything else ----
  // No ugcDate: a posted date is a bank fact, not an opinion.
  ugcAmount: numeric("ugc_amount", { precision: 14, scale: 2 }),
  ugcDescription: text("ugc_description"),
  ugcCategoryDetailed: text("ugc_category_detailed").references(() => categories.detailed),
  ugcBudgetId: text("ugc_budget_id").references(() => budgets.id, { onDelete: "set null" }),
  ugcTripId: text("ugc_trip_id").references(() => trips.id, { onDelete: "set null" }),
  ugcSubscriptionId: text("ugc_subscription_id")
    .references(() => subscriptions.id, { onDelete: "set null" }),
  ugcNote: text("ugc_note"),
  ugcIsHidden: boolean("ugc_is_hidden").default(false).notNull(),

  source: text("source").default("tiller").notNull(), // "tiller" | "plaid"
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),

  direction: text("direction").generatedAlwaysAs(
    sql`case when raw_amount > 0 then 'outflow' else 'inflow' end`
  ),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_txn_date").on(t.rawDate),
  index("idx_txn_account").on(t.accountId),
  index("idx_txn_merchant").on(t.rawMerchantName),
  index("idx_txn_budget").on(t.ugcBudgetId, t.aiBudgetId),
  index("idx_txn_trip").on(t.ugcTripId, t.aiTripId),
  index("idx_txn_unclassified").on(t.rawDate)
    .where(sql`ai_budget_id is null and ugc_budget_id is null`),
])

// ── corrections (append-only) ───────────────────────────────────────────
export const corrections = pgTable("corrections", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  field: correctionField("field").notNull(),
  fromValue: text("from_value"),                      // id, category code, or text
  toValue: text("to_value"),
  // Optional "why" — by far the highest-signal thing a prompt can carry.
  reason: text("reason"),
  // Snapshot at correction time. Denormalized on purpose: a few-shot example must stay
  // truthful even after the underlying row is edited or re-synced.
  snapMerchantName: text("snap_merchant_name"),
  snapDescription: text("snap_description"),
  snapAmount: numeric("snap_amount", { precision: 14, scale: 2 }),
  snapCategoryDetailed: text("snap_category_detailed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_corr_txn").on(t.transactionId),
  index("idx_corr_recent").on(t.createdAt),
])

// ── sync_runs ───────────────────────────────────────────────────────────
export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  windowStart: date("window_start").notNull(),        // usually the 1st of this month
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: syncStatus("status").default("running").notNull(),
  rowsRead: integer("rows_read").default(0).notNull(),
  accountsUpserted: integer("accounts_upserted").default(0).notNull(),
  txnsInserted: integer("txns_inserted").default(0).notNull(),
  txnsUpdated: integer("txns_updated").default(0).notNull(),
  unknownCategories: jsonb("unknown_categories").$type<string[]>().default([]).notNull(),
  error: text("error"),
})

// ── app_state (single-row KV) ───────────────────────────────────────────
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),   // "classification_guide"
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
```

### View

Every read path goes through this. No route hand-rolls the COALESCE. Named for what it does, not what it
is — no `v_` type prefix; see CLAUDE.md's naming convention.

```sql
create view resolved_transactions as
select
  transaction.id, transaction.account_id,
  transaction.raw_date                                                     as date,
  coalesce(transaction.ugc_amount, transaction.raw_amount)                 as amount,
  coalesce(transaction.ugc_description, transaction.raw_merchant_name,
           transaction.raw_description)                                    as description,
  coalesce(transaction.ugc_category_detailed, transaction.ai_category_detailed,
           transaction.raw_category_detailed)                              as category_detailed,
  coalesce(transaction.ugc_budget_id, transaction.ai_budget_id)            as budget_id,
  coalesce(transaction.ugc_trip_id, transaction.ai_trip_id)                as trip_id,
  coalesce(transaction.ugc_subscription_id, transaction.ai_subscription_id) as subscription_id,
  (transaction.ugc_budget_id is not null)                                  as budget_is_confirmed,
  transaction.direction, transaction.ugc_note, transaction.ugc_is_hidden,
  transaction.raw_amount, transaction.raw_description, transaction.raw_merchant_name,
  transaction.raw_category_detailed, transaction.ai_confidence, transaction.ai_reasoning,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name, 'source', transaction_tag.source))
    from transaction_tags transaction_tag join tags tag on tag.id = transaction_tag.tag_id
    where transaction_tag.transaction_id = transaction.id
  ), '[]'::jsonb)                                                          as tags
from transactions transaction;
```

---

## 5. API

Base `https://api.<domain>`. Every route requires `Authorization: Bearer $API_TOKEN`.
Errors are always `{ "error": { "code": "...", "message": "..." } }`.

### Ingest

**`POST /sync`** — no body. Pulls from Google Sheets server-side, upserts, returns.
Called on demand: web app mount, widget timeline refresh, or Bruno.

Query params:

| Param | Default | Notes |
|---|---|---|
| `since` | first of the current month | `YYYY-MM-DD`; filters on the sheet's `Date` column |
| `force` | `false` | bypasses the min-interval guard |

```jsonc
{ "syncRunId": "sr_...", "windowStart": "2026-08-01",
  "rowsRead": 84, "accountsUpserted": 11, "txnsInserted": 7, "txnsUpdated": 2,
  "unknownCategories": ["INCOME_WAGES"], "unclassifiedCount": 7, "skipped": false }
```

Rules:
- Upsert `onConflictDoUpdate` keyed on `id`. The `set` clause touches **only `raw_*`, `last_seen_at`,
  `updated_at`**. Never an `ai_*` or `ugc_*` column. Enforce this with a test — it's the one invariant
  that, once broken, silently destroys work you can't recreate.
- Accounts sync in full every run regardless of `since` (11 rows, and balances are point-in-time).
- Rows absent from the window are never deleted.
- Unknown `categoryDetailed` values are accepted and reported, not rejected.

Because this now runs in a page-load request path rather than a cron, two guards are load-bearing:
- **Advisory lock.** Wrap the run in `pg_try_advisory_lock(<const>)`. If it fails, return the in-flight
  `syncRunId` with `"skipped": true` rather than queueing. A widget refresh and a page load will collide.
- **Min interval.** If the last `ok` run finished under 5 minutes ago and `force` isn't set, return it
  verbatim with `"skipped": true`. Sheets quota is 300 reads/min/project and a React StrictMode double-mount
  will find it.

**On the MTD window:** it covers the widget, which only ever draws the current month. Two gaps to know
about. A cold database has no history, so run `POST /sync?since=2026-01-01` once by hand after migrating.
And a transaction that posts late with a prior-month date falls outside the window forever — if that shows
up in practice, widen the default to `date_trunc('month', now()) - interval '7 days'`.

### Read

| Route | Notes |
|---|---|
| `GET /accounts` | `?includeHidden=true` |
| `GET /transactions` | `?from&to&accountId&budgetId&tripId&tagId&subscriptionId&unassigned&q&limit=50&cursor` — keyset on `(date desc, id desc)` |
| `GET /transactions/:id` | includes `corrections[]` and `tags[]` |
| `GET /budgets` · `GET /trips` · `GET /tags` · `GET /subscriptions` | `?includeArchived` / `?includeInactive` |
| `GET /trips/:id` | plus rollup: total spend, by budget, by day |
| `GET /subscriptions` | plus `lastChargedAt`, `lastAmount`, `monthlyEquivalent`, `amountDrift` |
| `GET /categories` | Plaid PFC v2, grouped by primary |
| `GET /standing?month=2026-08` | **the widget endpoint** |
| `GET /health` | `{ ok, lastSyncAt, lastSyncStatus, unclassifiedCount }` |

`GET /standing` returns everything the widget draws in one call:

```jsonc
{
  "month": "2026-08", "dayOfMonth": 21, "daysInMonth": 31,
  "discretionary": { "target": "1800.00", "spent": "1388.00", "remaining": "412.00",
                     "paceDelta": "169.00", "tier": "warn" },
  "budgets": [
    { "id": "b_ess", "name": "Essentials", "class": "essential",
      "target": "800.00", "spent": "712.00", "remaining": "88.00", "tier": "warn" }
  ],
  "series": [{ "day": 1, "cumulative": "0.00" }],
  "activeTrip": { "id": "t_aunz", "name": "AU/NZ Trip", "endDate": "2026-08-24" },
  "asOf": "2026-08-21T06:00:00Z"     // = lastSyncAt; drives the stale state
}
```

### Write

**`PATCH /transactions/:id`** — accepts `ugcAmount`, `ugcDescription`, `ugcCategoryDetailed`,
`ugcBudgetId`, `ugcTripId`, `ugcSubscriptionId`, `ugcNote`, `ugcIsHidden`, `tagIds[]`, `reason`.

Writing any `ugc*` field **also appends a `corrections` row in the same DB transaction**, diffed against
the current effective value. That coupling lives in the handler so the log can't drift. `null` clears the
override and logs the reversal. `tagIds` replaces the `source = 'ugc'` set and logs adds and removes
separately; AI-sourced tag rows are promoted to `ugc` when you keep them and deleted when you don't.

**`POST` / `PATCH` / `DELETE`** on `/budgets`, `/trips`, `/tags`, `/subscriptions`.
Deleting a budget 409s if `isSystem`, otherwise reassigns orphans to the system budget.
Deleting a trip or subscription nulls the FKs; deleting a tag cascades the join rows.

### Classification

**`POST /classify`** — `{ "transactionIds"?: string[], "limit"?: 200, "force"?: false }`.
Default: everything with no budget on either column. Returns `{ classified, skipped, failed }`.
Call it after `/sync` resolves — don't chain it server-side, or a page load waits on the model.

Run the deterministic pre-filter first and skip the API call entirely when it hits:

1. **Subscription match** — `raw_merchant_name` matches `merchantPattern` and `|amount − expectedAmount| ≤ tolerance` → assign `ai_subscription_id` and the subscription's `budgetId`, confidence `1.0`. Outside tolerance: still link, flag drift, but send to Claude for the budget.
2. **Merchant precedent** — the same `raw_merchant_name` already has a `ugc_budget_id` → copy it.
3. **Trip window** — outside every trip's date range, `ai_trip_id` is null without asking.

Everything else batches to Claude (Haiku, 10/batch) with this payload:

```jsonc
{
  "budgets":       [{ "id", "name", "class", "description", "linkedCategories" }],
  "trips":         [{ "id", "name", "startDate", "endDate", "description" }],  // overlapping only
  "tags":          [{ "id", "name", "description" }],
  "subscriptions": [{ "id", "name", "merchantPattern", "expectedAmount", "cadence" }],
  "guide":         "…app_state.classification_guide…",
  "corrections":   [{ "merchant", "description", "amount", "category",
                      "field", "from", "to", "reason" }],
  "batch":         [{ "id", "description", "merchantName", "amount", "date",
                      "categoryDetailed", "accountName" }]
}
```

Returns per transaction: `budgetId`, `tripId | null`, `tagIds[]`, `subscriptionId | null`,
`categoryDetailed`, `confidence`, `reasoning` (one line). Use the native `output_config` / `json_schema`
structured output, not a prefill.

`corrections` is the last ~40 rows plus every correction touching a merchant in the current batch.
`guide` is the periodic summarization output, so the per-transaction prompt stays lean.

---

## 6. Ingest architecture

```
web app mount ─┐
widget refresh ─┼──> POST /sync ──> Google Sheets API ──> Neon
Bruno          ─┘         │
                          └──> client then calls POST /classify
```

No cron, no separate service, no script-to-API shared secret. `/sync` owns the Sheets read.

**Auth to Sheets.** GCP service account, JSON key in `GOOGLE_SERVICE_ACCOUNT_JSON` (base64 the whole blob —
Railway env vars and raw newlines don't mix). Share the sheet read-only with the SA email.
Scope `spreadsheets.readonly`.

**Reading.** One `spreadsheets.values.batchGet` for `Transactions!A:AA` and `Accounts!A:R`.
**Map columns by header text, never by letter.** Row 1 becomes a `name → index` map. Not optional — you
just inserted `Merchant Name`, which shifted every letter to its right, and Tiller's Sheets and Excel
templates disagree on positions anyway.

**Transforms, in order:**
1. Skip rows where `Source !== "Plaid"` or `Transaction ID` is blank.
2. Parse `Date` as `M/D/YYYY` → `YYYY-MM-DD` **explicitly**, not via `new Date()` — `8/1/26` is ambiguous and the runtime guesses wrong.
3. Drop rows where the parsed date `< windowStart`.
4. `amount = -Number(raw.replace(/[$,]/g, ""))` — Tiller negative-is-expense → Plaid positive-is-outflow.
5. Split `Category Hint` on `": "` → `[primary, detailed]`; null when blank.
6. Normalize `Type`: `"credit card"` → `credit`; `Class`: `"Liability"` → `liability`.

**Auth middleware.** One env var, compared in constant time:

```ts
import { timingSafeEqual } from "node:crypto"

app.use("*", async (c, next) => {
  const got = Buffer.from(c.req.header("authorization")?.slice(7) ?? "")
  const want = Buffer.from(process.env.API_TOKEN!)
  if (got.length !== want.length || !timingSafeEqual(got, want))
    return c.json({ error: { code: "UNAUTHORIZED", message: "Bad or missing token" } }, 401)
  await next()
})
```

`===` on a secret leaks its length and prefix through timing. One line to not do that.

---

## 7. Project setup

```
src/
  index.ts            # env read + fail-fast + Bun server export
  app.ts              # createApp() — Hono instance, middleware, route mounting
  middleware/auth.ts
  db/
    client.ts, schema.ts, testing.ts   # Neon client, tables/enums/view, PGlite test harness
    seeds/{index,categories,system-budget}.ts
    seeds/pfc-taxonomy-all.csv         # committed, source of the category seed
  routes/{sync,transactions,budgets,trips,tags,subscriptions,accounts,standing,classify}.ts
  lib/{sheets,tiller-map,amounts,standing,prefilter,claude,csv,pfc}.ts   # pure fns — the test surface
bruno/                # collection, committed
```

**Testing: `bun:test`.** Built into the runtime, Jest-compatible API, zero config, no transpile step —
no reason to add Vitest when the runtime ships a runner. Point it at `lib/`, where the risk is:

- `tiller-map`: header mapping survives an inserted column; non-Plaid and blank-ID rows skipped
- `amounts`: `-$1,234.56` → `1234.56`; `$10,000.00` → `-10000.00`
- date parsing: `8/1/26` is August 1 2026, and `windowStart` filtering is inclusive
- **the upsert guard** — a second `/sync` with changed raw data leaves every `ai_*` and `ugc_*` column byte-identical
- `prefilter`: subscription inside/outside tolerance, merchant precedent, trip-window boundaries (a transaction dated exactly on `endDate` is in)
- `standing`: day 1 (zero denominator), no target set, over budget

Integration tests run against a Neon branch, torn down per run.

**Railway:** one service, `bun run src/index.ts`.
**Env:** `DATABASE_URL`, `API_TOKEN`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `TILLER_SHEET_ID`.
**Bruno vars:** `{{baseUrl}}`, `{{apiToken}}`.
**Biome v2**, semicolons off, TS 7. **Lefthook** pre-commit: `biome check` + `bun test`.

---

## 8. Deliberately removed

Better Auth and any `user` table · `plaid_items` and access-token encryption · `/oauth-return` and Plaid
Link · `sync_log` cursors (no `/transactions/sync` to paginate) · `budget_classification_rules` (replaced
by `corrections`, which records transitions rather than static predicates) · Tiller's inferred `Category`,
`Tag`, and `Notes` columns · Plaid enrichment Tiller doesn't expose: `payment_channel`, `location_*`,
`counterparties`, `merchant_entity_id`, `logo_url`, `website`, `authorized_date`, `pending`,
`iso_currency_code`.

`merchant_entity_id` is the one worth mourning — Plaid's stable merchant key, and the strongest possible
signal for both dedup and subscription matching. `raw_merchant_name` is the stand-in until cutover, which
is why `subscriptions.merchantPattern` matches on text rather than an ID.

## 9. Deferred

Balance-history import (net worth trend) · per-month budget targets rather than one flat monthly figure ·
trip budgets and per-trip targets · transaction splits (`ugc_amount` covers the simple reimbursement case;
a real split needs a child table) · AI-proposed subscriptions and trips from recurrence detection (the
`source` column on both is already there for it) · what happens to Tiller-sourced rows at Plaid cutover —
the `source` column keeps the question answerable · the WidgetKit client, which consumes `GET /standing`
and nothing else.
