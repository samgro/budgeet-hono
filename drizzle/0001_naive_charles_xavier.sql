DROP VIEW "public"."resolved_transactions";--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "emoji" text;--> statement-breakpoint
CREATE INDEX "idx_txn_date_id" ON "transactions" USING btree ("raw_date","id");--> statement-breakpoint
CREATE VIEW "public"."resolved_accounts" AS (
  select
    account.id,
    coalesce(account.ugc_name, account.raw_name) as name,
    account.raw_name,
    account.raw_mask,
    account.raw_institution,
    account.raw_type,
    account.raw_class,
    account.raw_balance,
    account.raw_balance_as_of,
    account.ugc_is_hidden
  from accounts account
);--> statement-breakpoint
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
);