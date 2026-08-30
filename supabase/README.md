# Database

Migrations in `migrations/` are the source of truth for the schema, the row level
security policies and the database functions. They are plain SQL, applied in
filename order.

## Verifying without a database

```bash
npm run db:verify
```

This applies every migration to a throwaway Postgres running in WebAssembly
(PGlite), then asserts the result: tables and views exist, RLS is on everywhere,
the triggers behave, and members see their own car while outsiders see nothing.
It needs no Docker, no Supabase project and no network, so it is the fast check
to run after editing any SQL.

What it cannot check is anything specific to a real Supabase project — the actual
`auth` schema, PostgREST, or the JWT plumbing. `scripts/verify-migrations.mjs`
stubs those. Treat a pass as "the SQL is correct Postgres and the policies do what
they claim", not as "this is proven against Supabase".

## Applying to a real project

Once the Supabase project exists:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

To regenerate the TypeScript types after a schema change:

```bash
npx supabase gen types typescript --linked > src/lib/database.types.ts
```

## Conventions

- Odometer readings and distances are **whole kilometres**, stored as `integer`.
- Money is **integer cents**. No floating point is stored anywhere.
- A settlement period is every trip of a car with `fill_id is null`. Recording a
  fill stamps those trips rather than deleting them, which empties the dashboard
  and keeps the history.
- RLS is the authorization boundary. Application code does not decide who may
  read what; policies do.
- Tables that clients must never write directly — `memberships`, `fills`,
  `fill_shares` — have read policies only, and are not granted write privileges.
  Joining a car and settling a fill go through `security definer` functions.
- Helper functions used inside policies are `security definer` with
  `set search_path = ''`, because a policy on `memberships` that queries
  `memberships` would recurse forever.
