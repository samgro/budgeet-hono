CREATE TYPE "public"."account_class" AS ENUM('asset', 'liability');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit', 'investment', 'loan', 'other');--> statement-breakpoint
CREATE TYPE "public"."attribution" AS ENUM('ai', 'ugc');--> statement-breakpoint
CREATE TYPE "public"."budget_class" AS ENUM('fixed', 'essential', 'discretionary', 'income', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."correction_field" AS ENUM('budget', 'category', 'description', 'amount', 'tag', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('label', 'trip', 'business');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"raw_name" text NOT NULL,
	"raw_mask" text,
	"raw_institution" text NOT NULL,
	"raw_type" "account_type" NOT NULL,
	"raw_class" "account_class" NOT NULL,
	"raw_balance" numeric(14, 2),
	"raw_balance_as_of" timestamp with time zone,
	"ugc_name" text,
	"ugc_is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"class" "budget_class" NOT NULL,
	"target_amount" numeric(14, 2),
	"linked_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"detailed" text PRIMARY KEY NOT NULL,
	"primary" text NOT NULL,
	"description" text,
	"icon_url" text,
	"pfcv1_detailed" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"field" "correction_field" NOT NULL,
	"from_value" text,
	"to_value" text,
	"reason" text,
	"snap_merchant_name" text,
	"snap_description" text,
	"snap_amount" numeric(14, 2),
	"snap_category_detailed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"merchant_pattern" text NOT NULL,
	"expected_amount" numeric(14, 2),
	"amount_tolerance" numeric(14, 2) DEFAULT '2.00' NOT NULL,
	"cadence" "cadence" DEFAULT 'monthly' NOT NULL,
	"budget_id" text,
	"source" "attribution" DEFAULT 'ugc' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cancelled_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"window_start" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"accounts_upserted" integer DEFAULT 0 NOT NULL,
	"txns_inserted" integer DEFAULT 0 NOT NULL,
	"txns_updated" integer DEFAULT 0 NOT NULL,
	"unknown_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"kind" "tag_kind" DEFAULT 'label' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"start_date" date,
	"end_date" date,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"depth" integer GENERATED ALWAYS AS (case when parent_id is null then 0 else 1 end) STORED,
	"parent_depth" integer GENERATED ALWAYS AS (case when parent_id is null then null else 0 end) STORED,
	CONSTRAINT "uq_tags_id_depth" UNIQUE("id","depth"),
	CONSTRAINT "uq_tags_id_kind" UNIQUE("id","kind"),
	CONSTRAINT "trip_has_window" CHECK ((kind = 'trip') = (start_date is not null)),
	CONSTRAINT "window_ordered" CHECK (end_date is null or end_date >= start_date)
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"transaction_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"kind" "tag_kind" NOT NULL,
	"source" "attribution" NOT NULL,
	"is_rejected" boolean DEFAULT false NOT NULL,
	"ai_confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_tags_transaction_id_tag_id_pk" PRIMARY KEY("transaction_id","tag_id"),
	CONSTRAINT "rejected_is_ugc" CHECK (not is_rejected or source = 'ugc')
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"raw_date" date NOT NULL,
	"raw_amount" numeric(14, 2) NOT NULL,
	"raw_description" text NOT NULL,
	"raw_full_description" text,
	"raw_merchant_name" text,
	"raw_category_primary" text,
	"raw_category_detailed" text,
	"raw_check_number" text,
	"raw_imported_at" date,
	"ai_budget_id" text,
	"ai_subscription_id" text,
	"ai_category_detailed" text,
	"ai_confidence" real,
	"ai_model" text,
	"ai_reasoning" text,
	"ai_classified_at" timestamp with time zone,
	"ugc_amount" numeric(14, 2),
	"ugc_description" text,
	"ugc_category_detailed" text,
	"ugc_budget_id" text,
	"ugc_subscription_id" text,
	"ugc_note" text,
	"ugc_is_hidden" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'tiller' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" text GENERATED ALWAYS AS (case when raw_amount > 0 then 'outflow' else 'inflow' end::text) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_tags_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_parent_depth_tags_id_depth_fk" FOREIGN KEY ("parent_id","parent_depth") REFERENCES "public"."tags"("id","depth") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_parent_id_kind_tags_id_kind_fk" FOREIGN KEY ("parent_id","kind") REFERENCES "public"."tags"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_kind_tags_id_kind_fk" FOREIGN KEY ("tag_id","kind") REFERENCES "public"."tags"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ai_budget_id_budgets_id_fk" FOREIGN KEY ("ai_budget_id") REFERENCES "public"."budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ai_subscription_id_subscriptions_id_fk" FOREIGN KEY ("ai_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ai_category_detailed_categories_detailed_fk" FOREIGN KEY ("ai_category_detailed") REFERENCES "public"."categories"("detailed") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ugc_category_detailed_categories_detailed_fk" FOREIGN KEY ("ugc_category_detailed") REFERENCES "public"."categories"("detailed") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ugc_budget_id_budgets_id_fk" FOREIGN KEY ("ugc_budget_id") REFERENCES "public"."budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ugc_subscription_id_subscriptions_id_fk" FOREIGN KEY ("ugc_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_categories_primary" ON "categories" USING btree ("primary");--> statement-breakpoint
CREATE INDEX "idx_categories_pfcv1" ON "categories" USING gin ("pfcv1_detailed");--> statement-breakpoint
CREATE INDEX "idx_corr_txn" ON "corrections" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_corr_recent" ON "corrections" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tags_sibling_name" ON "tags" USING btree (coalesce(parent_id, ''),"name");--> statement-breakpoint
CREATE INDEX "idx_tags_parent" ON "tags" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_tags_trip_range" ON "tags" USING btree ("start_date","end_date") WHERE kind = 'trip';--> statement-breakpoint
CREATE INDEX "idx_txn_tags_tag" ON "transaction_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_txn_one_exclusive_kind" ON "transaction_tags" USING btree ("transaction_id","kind") WHERE kind <> 'label' and not is_rejected;--> statement-breakpoint
CREATE INDEX "idx_txn_date" ON "transactions" USING btree ("raw_date");--> statement-breakpoint
CREATE INDEX "idx_txn_account" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_txn_merchant" ON "transactions" USING btree ("raw_merchant_name");--> statement-breakpoint
CREATE INDEX "idx_txn_budget" ON "transactions" USING btree ("ugc_budget_id","ai_budget_id");--> statement-breakpoint
CREATE INDEX "idx_txn_unclassified" ON "transactions" USING btree ("raw_date") WHERE ai_budget_id is null and ugc_budget_id is null;--> statement-breakpoint
CREATE VIEW "public"."resolved_transactions" AS (
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
);