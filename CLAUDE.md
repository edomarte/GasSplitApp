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
| Database | Supabase Postgres + Drizzle ORM, with RLS |
| Email | Resend + React Email |
| QR codes | `qrcode` npm package, rendered server-side to a data URL |
| Hosting | Vercel |
| Settlement model | **Email only** — no running ledger, no "mark as paid", no balances screen |

Settled: 2026-08-30.

### Rejected alternatives (do not revisit without asking)
- Auth.js + Neon, and self-hosted Docker/VPS — rejected in favour of Supabase.
- Running per-member balance with payment tracking — rejected; `fill_shares` is a
  pure historical snapshot with no payment state.

## Non-negotiable conventions

- **Money is integer cents.** Never floats, never `number` euros.
- **Distances are integers** (metres, or tenths of a km). Never floats.
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

```
users            id, email, display_name, avatar_url            (Supabase auth.users)
cars             id, name, currency, initial_odometer, created_by, created_at
memberships      car_id, user_id, role(owner|member), joined_at
invites          id, car_id, token_hash, invited_email?, created_by, expires_at, accepted_by?
trips            id, car_id, recorded_by, start_km, end_km, driven_on, note, fill_id?
trip_shares      trip_id, user_id                                (one row per participant, incl. driver)
fills            id, car_id, paid_by, total_cents, odometer?, filled_on, created_at
fill_shares      fill_id, user_id, km_numerator, amount_cents    (immutable snapshot)
```

**Period = trips where `fill_id IS NULL`.** A fill does not delete anything: it stamps
every open trip of that car with its own id. That closes the period (so the dashboard
starts empty again, satisfying SPEC's "reset the trip") while keeping full history.

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

**Step 1 (scaffold + auth) is done.** Typecheck, lint and `next build` are clean;
the login, signup, reset and setup screens were checked in a browser at desktop and
mobile widths.

What exists:

```
src/proxy.ts                      session refresh + optimistic route protection
src/lib/env.ts                    env access; isSupabaseConfigured() gates the setup screen
src/lib/dal.ts                    requireUser() / getOptionalUser(), the real auth gate
src/lib/search-params.ts          firstParam() / safeNextParam()
src/lib/supabase/{client,server,proxy}.ts
src/app/auth/actions.ts           sign in, sign up, Google, password reset, sign out
src/app/auth/callback/route.ts    OAuth code exchange
src/app/auth/confirm/route.ts     emailed link verification (signup, recovery)
src/app/(auth)/{login,signup,forgot-password}/
src/app/setup/page.tsx            shown while Supabase env vars are missing
src/app/page.tsx                  signed-in home; cars list is still a placeholder
```

Supabase and Resend accounts do not exist yet. `.env.local` is absent on purpose, so
the app currently redirects everything to `/setup`, which lists the steps. Copy
`.env.local.example` to `.env.local` to switch auth on.

### Known gaps to close later
- `/account/password` (the password-reset landing page) is referenced by
  `requestPasswordReset` but not built yet.
- No tests yet; Vitest arrives with the split-math module in step 5.
- No git repository has been initialised.

Next step: step 2 (schema, migrations, RLS).
