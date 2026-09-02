# Budgeet

Private, single-user personal finance API. One user (me), bearer token, no user table, read-only over
bank data. Bun + Hono + Drizzle + Neon on Railway.

Data comes from a Tiller Google Sheet (Plaid-sourced) until Plaid production access lands. The first
consumer is an iOS Home Screen widget fed entirely by `GET /standing`.

Full spec: `docs/spec.md`. Each Linear ticket names the sections to read — read those, not the whole file.

## Two invariants

Breaking either loses data silently instead of erroring.

1. **`POST /sync` writes only `raw_*` columns** (plus `last_seen_at`, `updated_at`). Never `ai_*` or `ugc_*`.
2. **`POST /classify` writes only `ai_*` columns** and `transaction_tags` rows with `source: 'ai'`. Never `ugc_*`.

## Column prefixes

- `raw_` — from the bank, via Plaid → Tiller. Overwritten every sync.
- `ai_` — Claude's inference.
- `ugc_` — my edits. Never overwritten by anything.

Precedence is `ugc > ai > raw`, resolved once in the `v_transactions` view. Read paths query the view.
Never hand-roll a COALESCE in a handler — that gives the rule two definitions and they will diverge.

## Commands

```
bun test                    # bun:test, not vitest
bun run src/index.ts        # local API
bunx biome check --write    # lint + format
bunx drizzle-kit push       # apply schema to the Neon branch
```

Run `bun test` before finishing any task.

## Conventions

- No semicolons. Biome v2 owns formatting; don't hand-format.
- Financial domain naming over abstract naming: `direction: "inflow" | "outflow"`, not `sentiment: "positive" | "negative"`.
- Errors are always `{ error: { code, message } }`. Surface them; never swallow into `console.error`.
- Pure logic goes in `src/lib/` and gets unit tests. Route handlers stay thin.
- Custom components over pulling in a library for simple cases.

## Gotchas

- **Amounts use Plaid convention: positive = outflow.** Tiller is inverted, so `× −1` at ingest.
- **Parse Tiller dates explicitly.** `new Date("8/1/26")` guesses wrong and silently corrupts a year of data.
- **Map sheet columns by header text, never column letter.** Inserting a column shifts every letter to its right.
- `raw_category_detailed` has no FK — Plaid emits codes ahead of our seed. Accept unknowns, report them.
- Plaid's category hints are wrong often enough to matter. They're a prior, never a fact.

## Session protocol

One Linear ticket per session (project `Budgeet`, team prefix `SDG`). Work the ticket's checklist top to
bottom. Don't refactor code from an earlier epic — open a new ticket instead of widening the session. After finishing, return a brief description of what was done, a clear instruction for how to manually validate. Ask me if everything looks good to commit, push, and close completed linear tickets.
