DROP VIEW "public"."resolved_accounts";--> statement-breakpoint
CREATE VIEW "public"."resolved_accounts" AS (
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
);