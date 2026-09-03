// Verbatim from spec §4, with three deliberate deviations, each called out at
// its definition below:
//   1. categories.pfcv1Detailed - not in the spec at all. See its comment.
//   2. transactions.direction - explicit ::text cast on the generated expression.
//   3. index-callback parameters and SQL aliases spelled out in full, per
//      CLAUDE.md's naming convention (the spec itself uses `t`, `tt`, `tg`).

import { sql } from "drizzle-orm"
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export const accountType = pgEnum("account_type", [
  "checking",
  "savings",
  "credit",
  "investment",
  "loan",
  "other",
])
export const accountClass = pgEnum("account_class", ["asset", "liability"])
export const budgetClass = pgEnum("budget_class", [
  "fixed",
  "essential",
  "discretionary",
  "income",
  "excluded",
])
export const cadence = pgEnum("cadence", ["weekly", "monthly", "quarterly", "yearly"])
export const attribution = pgEnum("attribution", ["ai", "ugc"])
export const correctionField = pgEnum("correction_field", [
  "budget",
  "category",
  "description",
  "amount",
  "trip",
  "tag",
  "subscription",
])
export const syncStatus = pgEnum("sync_status", ["running", "ok", "error"])

// ── accounts ────────────────────────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(), // Tiller Account ID
  rawName: text("raw_name").notNull(), // "Ultimate Rewards®"
  rawMask: text("raw_mask"), // "7614"
  rawInstitution: text("raw_institution").notNull(), // "Chase"
  rawType: accountType("raw_type").notNull(),
  rawClass: accountClass("raw_class").notNull(),
  rawBalance: numeric("raw_balance", { precision: 14, scale: 2 }),
  rawBalanceAsOf: timestamp("raw_balance_as_of", { withTimezone: true }),
  ugcName: text("ugc_name"), // display override
  ugcIsHidden: boolean("ugc_is_hidden").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── categories (Plaid PFC v2 seed) ──────────────────────────────────────
export const categories = pgTable(
  "categories",
  {
    detailed: text("detailed").primaryKey(), // FOOD_AND_DRINK_GROCERIES
    primary: text("primary").notNull(), // FOOD_AND_DRINK
    description: text("description"),
    iconUrl: text("icon_url"),
    // Not in spec §4. Tiller's Plaid integration emits PFC v1, not v2 - see
    // CLAUDE.md's gotcha. Most v1 codes equal their v2 name; a few drift, and
    // OTHER_OTHER has two v1 aliases, so this is an array, not a scalar.
    // Sync (BUD-4) normalizes an incoming v1 code to v2 using this column
    // before it ever reaches raw_category_detailed.
    pfcv1Detailed: text("pfcv1_detailed").array().default([]).notNull(),
  },
  (table) => [
    index("idx_categories_primary").on(table.primary),
    index("idx_categories_pfcv1").using("gin", table.pfcv1Detailed),
  ],
)

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
export const trips = pgTable(
  "trips",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(), // "AU/NZ Trip"
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // Optional hints for Claude: destinations, who came, what counts.
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_trips_range").on(table.startDate, table.endDate)],
)

// ── tags ────────────────────────────────────────────────────────────────
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(), // "divorce", "cat"
  // Natural-language rule, same job as budgets.description.
  // "Anything for Pixel — vet, food, litter, boarding."
  description: text("description"),
  color: text("color"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: attribution("source").notNull(),
    aiConfidence: real("ai_confidence"), // null when source = 'ugc'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.tagId] }),
    index("idx_txn_tags_tag").on(table.tagId),
  ],
)

// ── subscriptions ───────────────────────────────────────────────────────
// Doubles as a deterministic pre-filter: merchant match + amount within tolerance
// assigns the budget with no API call at all.
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // "Netflix"
  // Matched case-insensitively against raw_merchant_name, then raw_description.
  merchantPattern: text("merchant_pattern").notNull(),
  expectedAmount: numeric("expected_amount", { precision: 14, scale: 2 }),
  // Absolute dollars. Outside tolerance → still linked, but flagged as a price change.
  amountTolerance: numeric("amount_tolerance", { precision: 14, scale: 2 })
    .default("2.00")
    .notNull(),
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
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Tiller Transaction ID
    accountId: text("account_id")
      .notNull()
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
    rawImportedAt: date("raw_imported_at"), // Tiller "Date Added"

    // ---- ai: written by /classify, never by /sync ----
    aiBudgetId: text("ai_budget_id").references(() => budgets.id, { onDelete: "set null" }),
    aiTripId: text("ai_trip_id").references(() => trips.id, { onDelete: "set null" }),
    aiSubscriptionId: text("ai_subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    aiCategoryDetailed: text("ai_category_detailed").references(() => categories.detailed),
    aiConfidence: real("ai_confidence"),
    aiModel: text("ai_model"), // "claude-haiku-4-5-20251001"
    aiReasoning: text("ai_reasoning"), // one line, for the correction UI
    aiClassifiedAt: timestamp("ai_classified_at", { withTimezone: true }),

    // ---- ugc: owned by you, never touched by anything else ----
    // No ugcDate: a posted date is a bank fact, not an opinion.
    ugcAmount: numeric("ugc_amount", { precision: 14, scale: 2 }),
    ugcDescription: text("ugc_description"),
    ugcCategoryDetailed: text("ugc_category_detailed").references(() => categories.detailed),
    ugcBudgetId: text("ugc_budget_id").references(() => budgets.id, { onDelete: "set null" }),
    ugcTripId: text("ugc_trip_id").references(() => trips.id, { onDelete: "set null" }),
    ugcSubscriptionId: text("ugc_subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    ugcNote: text("ugc_note"),
    ugcIsHidden: boolean("ugc_is_hidden").default(false).notNull(),

    source: text("source").default("tiller").notNull(), // "tiller" | "plaid"
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),

    // Spec's expression relies on Postgres inferring the literal type; cast
    // explicitly so the STORED column's type doesn't depend on resolution order.
    direction: text("direction").generatedAlwaysAs(
      sql`case when raw_amount > 0 then 'outflow' else 'inflow' end::text`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_txn_date").on(table.rawDate),
    index("idx_txn_account").on(table.accountId),
    index("idx_txn_merchant").on(table.rawMerchantName),
    index("idx_txn_budget").on(table.ugcBudgetId, table.aiBudgetId),
    index("idx_txn_trip").on(table.ugcTripId, table.aiTripId),
    index("idx_txn_unclassified")
      .on(table.rawDate)
      .where(sql`ai_budget_id is null and ugc_budget_id is null`),
  ],
)

// ── corrections (append-only) ───────────────────────────────────────────
export const corrections = pgTable(
  "corrections",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    field: correctionField("field").notNull(),
    fromValue: text("from_value"), // id, category code, or text
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
  },
  (table) => [
    index("idx_corr_txn").on(table.transactionId),
    index("idx_corr_recent").on(table.createdAt),
  ],
)

// ── sync_runs ───────────────────────────────────────────────────────────
export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  windowStart: date("window_start").notNull(), // usually the 1st of this month
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
  key: text("key").primaryKey(), // "classification_guide"
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── resolved_transactions (view) ─────────────────────────────────────────
// Every read path goes through this. No route hand-rolls the COALESCE - this
// is the one place ugc > ai > raw precedence is expressed. Named for what it
// does, not what it is: a `v_` type-prefix would tell a reader nothing that
// `\dv` doesn't already, and this repo's prefixes (raw_/ai_/ugc_) are reserved
// for provenance, which is information they can't get any other way.
export const resolvedTransactions = pgView("resolved_transactions", {
  id: text("id"),
  accountId: text("account_id"),
  date: date("date"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  description: text("description"),
  categoryDetailed: text("category_detailed"),
  budgetId: text("budget_id"),
  tripId: text("trip_id"),
  subscriptionId: text("subscription_id"),
  budgetIsConfirmed: boolean("budget_is_confirmed"),
  direction: text("direction"),
  ugcNote: text("ugc_note"),
  ugcIsHidden: boolean("ugc_is_hidden"),
  rawAmount: numeric("raw_amount", { precision: 14, scale: 2 }),
  rawDescription: text("raw_description"),
  rawMerchantName: text("raw_merchant_name"),
  rawCategoryDetailed: text("raw_category_detailed"),
  aiConfidence: real("ai_confidence"),
  aiReasoning: text("ai_reasoning"),
  tags: jsonb("tags").$type<{ id: string; name: string; source: "ai" | "ugc" }[]>(),
}).as(sql`
  select
    transaction.id,
    transaction.account_id,
    transaction.raw_date as date,
    coalesce(transaction.ugc_amount, transaction.raw_amount) as amount,
    coalesce(
      transaction.ugc_description,
      transaction.raw_merchant_name,
      transaction.raw_description
    ) as description,
    coalesce(
      transaction.ugc_category_detailed,
      transaction.ai_category_detailed,
      transaction.raw_category_detailed
    ) as category_detailed,
    coalesce(transaction.ugc_budget_id, transaction.ai_budget_id) as budget_id,
    coalesce(transaction.ugc_trip_id, transaction.ai_trip_id) as trip_id,
    coalesce(transaction.ugc_subscription_id, transaction.ai_subscription_id) as subscription_id,
    (transaction.ugc_budget_id is not null) as budget_is_confirmed,
    transaction.direction,
    transaction.ugc_note,
    transaction.ugc_is_hidden,
    transaction.raw_amount,
    transaction.raw_description,
    transaction.raw_merchant_name,
    transaction.raw_category_detailed,
    transaction.ai_confidence,
    transaction.ai_reasoning,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', tag.id, 'name', tag.name, 'source', transaction_tag.source)
        )
        from transaction_tags transaction_tag
        join tags tag on tag.id = transaction_tag.tag_id
        where transaction_tag.transaction_id = transaction.id
      ),
      '[]'::jsonb
    ) as tags
  from transactions transaction
`)
