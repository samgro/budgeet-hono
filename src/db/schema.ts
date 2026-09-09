// Verbatim from spec §4, with four deliberate deviations, each called out at
// its definition below:
//   1. categories.pfcv1Detailed - not in the spec at all. See its comment.
//   2. categories.name / primaryName replace the spec's description / iconUrl -
//      Plaid's prose description and icon URL are display data this app never
//      renders; curated display names are. See lib/category-names.ts.
//   3. transactions.direction - explicit ::text cast on the generated expression.
//   4. index-callback parameters and SQL aliases spelled out in full, per
//      CLAUDE.md's naming convention (the spec itself uses `t`, `tt`, `tg`).

import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
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
  unique,
  uniqueIndex,
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
  "tag",
  "subscription",
])
export const syncStatus = pgEnum("sync_status", ["running", "ok", "error"])
export const tagKind = pgEnum("tag_kind", ["label", "trip", "business"])

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
    name: text("name").notNull(), // Groceries - curated, not Plaid's
    primaryName: text("primary_name").notNull(), // Food & Drink - curated, not Plaid's
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
  // Display only - no precedence rule, unlike the ugc_/ai_/raw_ columns.
  color: text("color"),
  emoji: text("emoji"),
  targetAmount: numeric("target_amount", { precision: 14, scale: 2 }), // per month
  linkedCategories: jsonb("linked_categories").$type<string[]>().default([]).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  // Exactly one system budget: the mandatory "Unassigned" catch-all. Cannot be deleted.
  isSystem: boolean("is_system").default(false).notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

// ── tags ────────────────────────────────────────────────────────────────
// A trip is a tag with a date window; a business is a tag with children -
// unified here rather than kept as separate tables (SDG-209). A date window
// is a *candidate* filter, not an assignment: the mortgage that autopays
// mid-trip is not trip spend. Claude decides inside the window, and
// transaction_tags.isRejected is what lets it say "no" and have that stick.
export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id").references((): AnyPgColumn => tags.id, { onDelete: "restrict" }),
    kind: tagKind("kind").default("label").notNull(),
    name: text("name").notNull(), // "food", not "cat / food"
    // Natural-language rule, same job as budgets.description.
    // "Anything for Pixel — vet, food, litter, boarding."
    description: text("description"),
    color: text("color"),
    emoji: text("emoji"),

    // trip-only, null for every other kind
    startDate: date("start_date"),
    endDate: date("end_date"),

    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

    // Caps nesting at two levels declaratively: a child is depth 1 and its
    // parentDepth is 0, so the composite FK below can only ever resolve to a
    // root. No trigger, no app-level check.
    depth: integer("depth").generatedAlwaysAs(sql`case when parent_id is null then 0 else 1 end`),
    parentDepth: integer("parent_depth").generatedAlwaysAs(
      sql`case when parent_id is null then null else 0 end`,
    ),
  },
  (table) => [
    // Postgres permits FKs onto generated columns except with set null/set
    // default actions, hence restrict on parentId above - which is the
    // behaviour we want anyway: deleting `cat` out from under `cat -> food`
    // should fail loudly rather than silently orphan.
    foreignKey({
      columns: [table.parentId, table.parentDepth],
      foreignColumns: [table.id, table.depth],
    }),
    // Makes a child inherit its parent's kind. Without this a `label` could
    // hang off a `business` root and quietly escape the /standing exclusion.
    //
    // Kept declared here even though `bunx drizzle-kit push` cannot apply a
    // *change* to it without crashing (a confirmed drizzle-kit 0.31.10 bug:
    // a composite unique constraint targeted by more than one FK - this one
    // is targeted by both this FK and transaction_tags' below - is always
    // reported as needing a drop+recreate, even when nothing changed, and
    // the generated DROP isn't ordered after its dependent FKs, so it fails
    // with "cannot drop constraint ... because other objects depend on it".
    // uq_tags_id_depth above has only one dependent FK and never hits this.
    // Declaring it here anyway - matching the live database exactly - is
    // deliberate: if schema.ts stopped declaring it, a *future*, bug-fixed
    // drizzle-kit would see "the database has a constraint schema.ts doesn't
    // want" and actually drop it. A push touching this table will keep
    // failing loudly until drizzle-kit is upgraded past this bug; that's a
    // safe failure (nothing partially applies), not a silent one. See
    // drizzle-team/drizzle-orm#4789 for the same class of bug.
    foreignKey({
      columns: [table.parentId, table.kind],
      foreignColumns: [table.id, table.kind],
    }),
    unique("uq_tags_id_depth").on(table.id, table.depth),
    unique("uq_tags_id_kind").on(table.id, table.kind),
    // Wrapped in coalesce because Postgres treats NULLs as distinct in
    // unique indexes and would otherwise permit two root tags named "cat".
    // "food" under `cat` and "food" under `groceries` are different tags -
    // this replaces a plain unique() on name, which can no longer hold.
    uniqueIndex("uq_tags_sibling_name").on(sql`coalesce(parent_id, '')`, table.name),
    index("idx_tags_parent").on(table.parentId),
    index("idx_tags_trip_range").on(table.startDate, table.endDate).where(sql`kind = 'trip'`),
    check("trip_has_window", sql`(kind = 'trip') = (start_date is not null)`),
    check("window_ordered", sql`end_date is null or end_date >= start_date`),
  ],
)

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    // The plain FK to tags.id and the composite FK to (tags.id, tags.kind)
    // below are both real, both declared, and deliberately redundant: the
    // plain one is drizzle-kit's own auto-derived shape for a text column
    // pointing at tags.id, and removing it would make schema.ts describe
    // less than what the database actually enforces.
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    kind: tagKind("kind").notNull(), // denormalized; held honest by the composite FK below
    source: attribution("source").notNull(),
    // Tombstone for a trip/business the model guessed and you rejected - see
    // the tags comment above. Only a ugc row may be rejected: the model
    // doesn't get to tombstone its own suggestions, it just doesn't re-emit
    // them.
    isRejected: boolean("is_rejected").default(false).notNull(),
    aiConfidence: real("ai_confidence"), // null when source = 'ugc'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.tagId] }),
    // See the comment on tags' matching FK above for why this is declared
    // even though a `push` touching this table will fail on the drizzle-kit
    // bug it triggers.
    foreignKey({
      columns: [table.tagId, table.kind],
      foreignColumns: [tags.id, tags.kind],
    }).onDelete("cascade"),
    index("idx_txn_tags_tag").on(table.tagId),
    // Keyed on (transactionId, kind) rather than one index per kind, so a
    // business trip is expressible (one trip row plus one business row)
    // while two businesses on one transaction is not. Encodes "label is the
    // only multi-valued kind" - the durable version of the rule, and it
    // absorbs a future kind without another index.
    uniqueIndex("uq_txn_one_exclusive_kind")
      .on(table.transactionId, table.kind)
      .where(sql`kind <> 'label' and not is_rejected`),
    check("rejected_is_ugc", sql`not is_rejected or source = 'ugc'`),
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
    // Serves the keyset pagination in GET /transactions - (date desc, id desc)
    // is a backward scan over this, no separate DESC index needed.
    index("idx_txn_date_id").on(table.rawDate, table.id),
    index("idx_txn_account").on(table.accountId),
    index("idx_txn_merchant").on(table.rawMerchantName),
    index("idx_txn_budget").on(table.ugcBudgetId, table.aiBudgetId),
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
  businessId: text("business_id"),
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
  tags: jsonb("tags").$type<
    {
      id: string
      name: string
      parentId: string | null
      kind: "label" | "trip" | "business"
      color: string | null
      emoji: string | null
      path: string
      source: "ai" | "ugc"
    }[]
  >(),
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
    (
      select transaction_tag.tag_id
      from transaction_tags transaction_tag
      where transaction_tag.transaction_id = transaction.id
        and transaction_tag.kind = 'trip'
        and not transaction_tag.is_rejected
    ) as trip_id,
    (
      select coalesce(tag.parent_id, tag.id)
      from transaction_tags transaction_tag
      join tags tag on tag.id = transaction_tag.tag_id
      where transaction_tag.transaction_id = transaction.id
        and transaction_tag.kind = 'business'
        and not transaction_tag.is_rejected
    ) as business_id,
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
          jsonb_build_object(
            'id', tag.id,
            'name', tag.name,
            'parentId', tag.parent_id,
            'kind', tag.kind,
            'color', tag.color,
            'emoji', tag.emoji,
            'path', case
              when parent.id is null then tag.name
              else parent.name || ' / ' || tag.name
            end,
            'source', transaction_tag.source
          )
        )
        from transaction_tags transaction_tag
        join tags tag on tag.id = transaction_tag.tag_id
        left join tags parent on parent.id = tag.parent_id
        where transaction_tag.transaction_id = transaction.id
          and not transaction_tag.is_rejected
      ),
      '[]'::jsonb
    ) as tags
  from transactions transaction
`)

// ── resolved_accounts (view) ─────────────────────────────────────────────
// Same rule as resolved_transactions: the account display name is a
// precedence rule (ugc_name > a fallback), so it gets exactly one definition
// here rather than a COALESCE repeated in every route that joins accounts.
// A blank ugc_name - null or empty/whitespace-only, hence nullif(trim(...)) -
// falls back to "institution rawName ••mask" (mask omitted when there is
// none) rather than bare raw_name, since a bank's own account name is often
// unhelpfully generic ("Ultimate Rewards®") without the bank and last-4 to
// tell same-institution accounts apart.
export const resolvedAccounts = pgView("resolved_accounts", {
  id: text("id"),
  name: text("name"),
  rawName: text("raw_name"),
  rawMask: text("raw_mask"),
  rawInstitution: text("raw_institution"),
  rawType: text("raw_type"),
  rawClass: text("raw_class"),
  rawBalance: numeric("raw_balance", { precision: 14, scale: 2 }),
  rawBalanceAsOf: timestamp("raw_balance_as_of", { withTimezone: true }),
  ugcIsHidden: boolean("ugc_is_hidden"),
}).as(sql`
  select
    account.id,
    coalesce(
      nullif(trim(account.ugc_name), ''),
      account.raw_institution || ' ' || account.raw_name ||
        case when account.raw_mask is null then '' else ' ••' || account.raw_mask end
    ) as name,
    account.raw_name,
    account.raw_mask,
    account.raw_institution,
    account.raw_type,
    account.raw_class,
    account.raw_balance,
    account.raw_balance_as_of,
    account.ugc_is_hidden
  from accounts account
`)
