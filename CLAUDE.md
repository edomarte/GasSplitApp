# Gas Split App

Webapp for co-owners of a shared car to log odometer trips and split fuel costs
proportionally to the kilometres each person drove. Requirements live in `SPEC.md`;
this file records the decisions taken on top of it.

## Decisions

| Concern | Decision |
|---|---|
| App framework | Next.js 16 (App Router, Turbopack) + TypeScript |
| UI | Tailwind v4 + shadcn/ui (radix base, nova preset), mobile-first |
| Installability | PWA (manifest + icons) — "Add to Home Screen" on iOS/Android |
| Auth | Supabase Auth: Google OAuth + email/password |
| Database | Supabase Postgres with RLS; `supabase-js` + generated types, no ORM |
| Email | Resend + React Email |
| QR codes | `qrcode` npm package, rendered server-side to a data URL |
| Hosting | Vercel |
| Settlement model | **Email only** — no running ledger, no "mark as paid", no balances screen |

Settled: 2026-08-30.

### Rejected alternatives (do not revisit without asking)
- Auth.js + Neon, and self-hosted Docker/VPS — rejected in favour of Supabase.
- Running per-member balance with payment tracking — rejected; `fill_shares` is a
  pure historical snapshot with no payment state.
- Drizzle ORM — adopted on 2026-08-30, dropped the same day once the schema made
  the conflict clear: Drizzle connects over direct Postgres as a privileged role,
  which bypasses RLS and would put authorization in two places. `supabase-js`
  carries the caller JWT so policies apply automatically, and settlement needs a
  Postgres function for atomicity rather than an ORM transaction.

## Non-negotiable conventions

- **Money is integer cents.** Never floats, never `number` euros.
- **Distances are whole kilometres**, stored as `integer`. Never floats.
- **Split math lives in a pure, dependency-free module** with no DB or framework
  imports, so it is unit-testable on its own. Test it with Vitest.
- **Settlement runs server-side in a single transaction.** Never in the client.
- **RLS everywhere**: a user can only read rows for cars they are a member of.
- **Auth checks go in the DAL** (`src/lib/dal.ts`), called from pages and Server
  Actions — never in a layout. Layouts do not re-render on navigation and do not
  gate the segments below them.
- Any `?next=` value is validated as a same-site relative path before redirecting.

## Next.js 16 gotchas (this is not Next 15)

`node_modules/next/dist/docs/` is the authoritative reference — read it before writing
framework code. The traps that have already bitten:

- **`middleware.ts` is now `proxy.ts`** (`src/proxy.ts`), exporting `proxy`. Node.js
  runtime only; the edge runtime is not supported there.
- **`cookies()`, `headers()`, `params`, `searchParams` are async.** Synchronous access
  was removed, so `createClient()` in `src/lib/supabase/server.ts` is async too.
- Turbopack is the default for both `dev` and `build`.
- `next lint` is gone; the `lint` script calls `eslint` directly.
- Global `PageProps` / `LayoutProps` types come from `npx next typegen`. Run it after
  adding routes, or `tsc --noEmit` fails on a fresh checkout.

## Data model

Defined in `supabase/migrations/`, which is the source of truth. See
`supabase/README.md` for how to apply and verify it.

```
profiles     id -> auth.users, email, display_name, avatar_url
cars         id, name, currency, initial_odometer_km, created_by
memberships  car_id, user_id, role(owner|member), joined_at        [pk: car_id+user_id]
invites      id, car_id, token_hash, invited_email, created_by, expires_at, accepted_by/at
fills        id, car_id, paid_by, total_cents, odometer_km, filled_on
trips        id, car_id, recorded_by, start_km, end_km, distance_km (generated),
             driven_on, note, fill_id -> fills            [fill_id null = open period]
trip_shares  trip_id, user_id                             [one row per participant]
fill_shares  fill_id, user_id, km_scaled, km_scale, amount_cents
```

Two views, both `security_invoker` so RLS applies to whoever queries them:
`open_period_km` (per-member km for the dashboard) and `car_odometer` (the
reading to prefill "start distance" with).

**Period = trips where `fill_id IS NULL`.** A fill does not delete anything: it
stamps every open trip of that car with its own id. That closes the period (so
the dashboard starts empty again, satisfying SPEC's "reset the trip") while
keeping full history.

`fill_shares` stores km as the exact rational `km_scaled / km_scale`. A three-way
split of a 100 km trip is 100/3 km, which no decimal column holds exactly;
rounding happens once, on the money.

## Core logic

Distance per member, over the open period:

```
for each trip where car_id = X and fill_id is null:
    distance = end_km - start_km
    participants = trip_shares rows (driver alone, or driver + selected members)
    each participant += distance / participants.count
```

Kept as exact rationals or scaled integers — no float drift on 3-way splits.

Settlement, in one transaction:
1. Lock the car's open trips; recompute km per member.
2. `amount_i = total_cents * km_i / km_total`, allocated by **largest-remainder** so
   shares sum to the total exactly — no lost or phantom cent.
3. Insert `fill_shares`; stamp trips with `fill_id`.
4. Send each member an email: who paid, their km share, what they owe.

### Edge cases (agreed handling)
- Zero km in the period → refuse the fill with a clear message (split undefined).
- Member joins mid-period → owes only for their own km; nothing if they drove nothing.
- `end_km <= start_km` → block.
- `start_km` below the last recorded odometer → warn, do not block (people forget to log).
- Settled trips are read-only. Open trips are editable/deletable by their recorder.
- Trip form autofills start = highest `end_km` in the car, else `cars.initial_odometer`.

## Screens

- `/login` — Google button + email/password
- `/` — your cars; create a car
- `/cars/[id]` — dashboard: per-member km since last fill, period total, Add trip / Add fuel fill, recent trips
- Trip sheet — start (prefilled) / end / date picker / "split drive" toggle → member multi-select
- Fill sheet — cost, date, live preview of the split before confirming
- `/cars/[id]/history` — past fills, expandable to their breakdown
- `/cars/[id]/members` — member list, invite by QR code + email
- `/join/[token]` — accept invite (sign in first if needed)

## Build order

1. Scaffold, Supabase project, auth flows (Google + email/password), protected layout
2. Schema + migrations + RLS policies
3. Cars, memberships, invites (token → QR → email → join flow)
4. Trips: create with split-drive selection, list, edit/delete, dashboard aggregation
5. Fills + settlement transaction + settlement email — split-math unit tests written first
6. History, PWA manifest, timezone/date correctness, empty & error states
7. Deploy to Vercel, smoke-test on a real iPhone and Android

## Status

**Steps 1 and 2 are done and verified against the live Supabase project.**
Typecheck, lint, `next build` and `npm run db:verify` are clean.

The project `pmilgglxbbtyuncwrony` (eu-west-1, Postgres 17) is linked, both
migrations are applied, and `src/lib/database.types.ts` is generated from it.

Step 1 — scaffold and auth:

```
src/proxy.ts                      session refresh + optimistic route protection
src/lib/env.ts                    env access; isSupabaseConfigured() gates the setup screen
src/lib/dal.ts                    requireUser() / getOptionalUser() / getMyProfile()
src/lib/search-params.ts          firstParam() / safeNextParam()
src/lib/supabase/{client,server,proxy}.ts   all typed with Database
src/app/auth/actions.ts           sign in, sign up, Google, password reset, sign out
src/app/auth/callback/route.ts    OAuth code exchange
src/app/auth/confirm/route.ts     emailed links: token_hash and PKCE code
src/app/(auth)/{login,signup,forgot-password}/
src/app/setup/page.tsx            shown while Supabase env vars are missing
src/app/page.tsx                  signed-in home; cars list is still a placeholder
```

Step 2 — schema and RLS:

```
supabase/migrations/20260830090000_initial_schema.sql
supabase/migrations/20260830090100_rls_policies.sql
supabase/README.md                how to apply, verify and extend the schema
scripts/verify-migrations.mjs     npm run db:verify — applies the SQL to PGlite
src/lib/database.types.ts         generated; regenerate after every migration
```

### Verified end to end against the live project
Sign up (confirmation required), emailed confirmation link, sign in, sign out,
signed-in redirect away from `/login`, signed-out redirect to `/login?next=...`,
wrong password, expired link. The profile trigger fires and the home page reads
the row back through RLS. Anonymous REST reads are refused with `42501` on every
table.

A test account `edomarte+gassplit@gmail.com` exists in the project. Delete it
from Authentication → Users when it stops being useful.

### Project configuration that the code depends on
- `mailer_autoconfirm` is **off**, so signup requires a clicked email link.
- Google is **not** enabled yet; the button is wired but the provider is off.
- Redirect URLs must include `/auth/callback` and `/auth/confirm`.

### Known gaps to close later
- `/account/password` (the password-reset landing page) is referenced by
  `requestPasswordReset` but not built yet.
- No settlement function yet. `fills` and `fill_shares` deliberately have no
  write policies, so the settlement `security definer` function in step 5 is
  what will make recording a fill possible at all.
- No join-by-invite function yet. `memberships` likewise has no insert policy,
  so step 3 must add a `security definer` redeem function.
- The split-math module and its Vitest suite arrive in step 5.

Next step: step 3 (cars, memberships, invites).
