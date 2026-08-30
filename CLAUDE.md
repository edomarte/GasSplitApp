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
| Email | SMTP via nodemailer — any provider, currently Gmail |
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
  imports, so it is unit-testable on its own — `src/lib/apportion.ts`.
- **Prefer named steps over one clever statement where money is involved.** The
  first `settle_fill` computed the leftover cents with window functions and
  handed the same spare cent to two people — 7241 paid out on a 7240 fill. The
  explicit version can be checked a line at a time, and is worth the extra rows.
- **Anything split between people goes through `apportion()`.** Rounding each
  share on its own loses units: three people sharing 100 km each get 33, and the
  column reads 99 under a total of 100. Largest remainder keeps the sum exact.
  Used for kilometres on screen and for cents at settlement.
- **Every `?next=` goes through `safeRelativePath`** in `src/lib/safe-redirect.ts`.
  Never re-implement the check inline; that is how one copy drifts and becomes an
  open redirect.
- **Never `insert(...).select()` a row whose visibility comes from a trigger.**
  RETURNING is evaluated before AFTER-triggers fire, so the SELECT policy sees a
  row you are not yet a member of and the whole insert fails with 42501.
  Generate the id client-side instead — see `createCar`.
- **`select ... for update` applies the UPDATE policy, not just SELECT.** A row
  you may read but not write vanishes from a locking read, which collapses every
  distinct case into "not found". Read plainly, then check the UPDATE row count
  — see `update_trip`.
- **Writes that span two tables need a database function.** A trip without
  participants fails the deferred trigger at the end of the first request, so
  two PostgREST calls can never work. Same reasoning as the invite functions.
- **Numbers and dates shown to users go through `src/lib/format.ts`,** not
  `toLocaleString()`. The server's locale is not the reader's, and "92.450 km"
  means two different things either side of the Alps. `formatDay` parses a
  `date` column in UTC: `new Date("2026-08-30")` is midnight UTC, which is still
  the 29th anywhere west of Greenwich.
- **`NEXT_PUBLIC_SITE_URL` must have no trailing slash**, and `normalizeOrigin`
  enforces it. Everything builds `${siteUrl}/join/...`, so a trailing slash gives
  `//join/...` — which Vercel redirects, hiding the problem, while Supabase
  matches `redirectTo` against an exact allowlist and would silently refuse
  `//auth/callback`.
- **Validate an id's shape before querying with it.** Postgres raises on a
  malformed uuid rather than returning no rows, so a typo in the address bar
  becomes "something went wrong" instead of a 404. See `isUuid`.
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
scripts/write-policy-checks.mjs   the write policies, run as `authenticated`
src/lib/database.types.ts         generated; regenerate after every migration
```

Step 3 — cars, members and invites:

```
supabase/migrations/20260830140000_invite_functions.sql
                                  invite_preview() and redeem_invite()
scripts/invite-function-checks.mjs
src/lib/cars.ts                   reads; RLS does the filtering, not these
src/lib/invite-token.ts           token generation and hashing
src/lib/email.ts                  Resend, reporting `skipped` until configured
src/lib/format.ts                 locale-independent number formatting
src/app/cars/actions.ts           create/delete car, invite, redeem, leave, remove
src/app/cars/[carId]/             car page and members page
src/app/join/[token]/             the invite landing page
```

**A member who leaves keeps the kilometres they drove.** `trip_shares` points at
`profiles`, not `memberships`, and the distance is a fact someone has to be
charged for. `appears_in_your_car()` keeps their name readable to the group, the
dashboard marks them "(left the car)", and `update_trip` lets them stay on a trip
they were on without letting anyone new be added.

**Invites are single use** and expire after 7 days. The raw token exists only in
the link; the database stores and receives its SHA-256 hash, so a leaked
`invites` table cannot be used to join anything. `redeem_invite` locks the row,
so two people opening the same link cannot both win.

### How to check your work

```
npm run test        vitest — pure logic (redirect safety today, split math later)
npm run db:verify   applies migrations to PGlite and asserts structure + RLS
npm run typecheck   tsc --noEmit
npm run lint        eslint
npm run build       production build; behaviour was confirmed under next start too
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
- `mailer_autoconfirm` is **on** (turned on 2026-08-30 to make testing cheap).
  Turn it back off before launch — see "Before launch".
- Google **is** enabled. The button appeared on its own — `enabledProviders()`
  asks the auth server rather than reading a build-time flag, so no redeploy was
  needed. Google's authorised redirect URI must be Supabase's
  `/auth/v1/callback`, not the app's `/auth/callback`.
- Redirect URLs must include `/auth/callback` and `/auth/confirm`.
- Email goes out over **SMTP**, not a provider API, so any of Gmail, Brevo,
  Mailjet or Resend works by changing four environment variables. Resend was
  dropped because it requires a verified domain, and the configured one was not
  owned. Gmail needs 2-Step Verification and an App Password; it rewrites the
  From header to the authenticated account, so `EMAIL_FROM` must use the same
  address as `SMTP_USER`.
- Supabase sends its own auth email — signup confirmation, password reset, email
  change — and never touches SMTP settings. Those worked throughout.

### Test data on the live project
- `edomarte+gassplit@gmail.com` ("Edoardo") owns **Fiat Panda**, 92 450 km.
- `edomarte+flatmate@gmail.com` ("Giulia") is a member of it, and owns
  **Giulia Only** — deliberately kept as a car Edoardo is not in, which is what
  the non-member 404 check uses.

### Before launch
- **Turn "Confirm email" back on.** It is currently off to make testing cheap.
  With it off, signup answers "that email cannot be used" for an address that
  already exists, which lets someone enumerate accounts and undercuts the vague
  answers on sign-in and reset. With it on, Supabase returns a decoy success and
  says nothing. No wording fixes this while it is off, because there is no email
  to point the user at.
- Enable Google, or leave it off: the button hides itself either way.
- Delete the `edomarte+gassplit@gmail.com` test account.

### Known gaps to close later
- `/account/password` (the password-reset landing page) is referenced by
  `requestPasswordReset` but not built yet.
- No settlement function yet. `fills` and `fill_shares` deliberately have no
  write policies, so the settlement `security definer` function in step 5 is
  what will make recording a fill possible at all.
- No join-by-invite function yet. `memberships` likewise has no insert policy,
  so step 3 must add a `security definer` redeem function.
- The split-math module and its Vitest suite arrive in step 5.
- Session expiry and refresh have never been observed; the proxy is only proven
  for a fresh session.

### Verified live for step 3
Create a car, invite by link and by email, sign up through an invite, join,
leave, rejoin, remove a member, revoke an invite, and a revoked link going dead.
A non-member gets a 404 on both `/cars/[id]` and `/cars/[id]/members` — the same
answer as a car that does not exist, so the id is never confirmed. All of it
again under `next start`, not just `next dev`.

Not verified: the Copy button (clipboard permissions in an automated browser),
and scanning the QR with a real camera — the code encodes
`NEXT_PUBLIC_SITE_URL`, which is localhost until the app is deployed.

### Verified live for step 4
Solo, two-way and three-way trips recorded from three accounts, with the
arithmetic checked at every step. Editing a solo trip into a split one, deleting
a trip, and back-dating one all re-derived the totals and the odometer. A member
sees every trip but can only edit or delete their own. Also checked in the
browser: the end-before-start error, the "starts below the last reading" warning
in the case it is meant for, and the trip routes under `next start`.

Step 4 — trips:

```
supabase/migrations/20260830160000_trip_functions.sql
                                  add_trip() and update_trip(), INVOKER rights
scripts/trip-function-checks.mjs
src/lib/trips.ts                  listOpenTrips() and getOpenPeriod()
src/app/cars/trip-actions.ts      saveTrip() and deleteTrip()
src/components/cars/trip-dialog.tsx    add and edit, with the split picker
src/components/cars/trip-list.tsx
src/components/cars/period-summary.tsx
src/lib/apportion.ts              largest remainder; used for km now, cents in step 5
supabase/migrations/20260830180000_former_members.sql
scripts/former-member-checks.mjs
```

### Step 5, turn 1 — settlement (done)

```
supabase/migrations/20260830200000_settlement.sql   settle_fill(), lcm_bigint()
scripts/settlement-checks.mjs                       23 checks + 40-case property test
```

`settle_fill` is SECURITY DEFINER and is the only way a fill can exist. It has to
be: it stamps trips recorded by other people, which the UPDATE policy on `trips`
forbids, and `fills`/`fill_shares` have no insert policies at all. RLS is
bypassed inside, so every check is explicit.

The arithmetic is exact end to end. Per-member distance is a sum of fractions, so
the period is scaled by the lowest common multiple of its participant counts —
a solo trip plus a three-way split scales by 3 — which makes every weight a whole
number. Cents are then divided by largest remainder. Verified across 40
amount/shape combinations: the shares always sum to exactly what was paid, and
nobody is ever more than one cent from their exact share.

Turn 2 is the UI: the fill dialog with a live preview, the history page, and the
settlement email. `apportion()` drives the preview; the amounts people are
actually charged are read back from `fill_shares`, so the two can never drift.
Emails can only reach edomarte@gmail.com until a domain is verified with Resend
— see "Before launch".

### Step 5, turn 2 — fill, history, notifications (done)

```
src/lib/money.ts                  parseMoneyToCents; "72,40" and "72.4" both work
src/lib/email-templates.ts        pure, testable, no transport and no server-only
src/lib/fills.ts                  reads settled fills back out of fill_shares
src/app/cars/fill-actions.ts      recordFill(): settle, then notify
src/components/cars/fill-dialog.tsx    live preview, then the recorded result
src/app/cars/[carId]/history/     past fills and their breakdowns
```

Verified live on Fiat Panda: a 410 km period with a three-way split settled for
€72.40 as €36.79 / €29.72 / €5.89, which is exact. The period closed, the trips
were kept, the history page shows the breakdown, and a second fill settled the
next period cleanly.

Two rules this turn added:
- **An action whose result is rendered from `useActionState` must not
  `revalidatePath`.** Refreshing the route remounts the component and throws the
  result away, so the work succeeds and the screen says nothing — which reads
  as failure. It bit the settlement dialog in step 5 and the password form
  after that, despite this note already existing. Refresh on dismissal, or not
  at all when nothing on screen depends on the change.
- **Every column of rounded figures goes through `apportion()`,** history
  included. It was fixed on the dashboard in step 4 and reintroduced here.

### Known gaps to close later
- `/account/password` (the password-reset landing page) is referenced by
  `requestPasswordReset` but not built yet.
- Notifications reach nobody but `edomarte@gmail.com` until a domain is verified
  with Resend. The failure is reported in the UI rather than hidden, and the
  settlement itself is unaffected.
- A settled fill cannot be undone. Deleting one would have to reopen the period,
  and nothing does that yet.

### Step 6 — installable, and failing gracefully (done)

```
scripts/generate-icons.mjs        npm run icons — one SVG to five PNGs
src/app/manifest.ts               installable as a standalone app
src/app/{error,not-found}.tsx     vague on screen, specific in the console
src/app/cars/[carId]/**/loading.tsx    skeletons for the multi-query pages
src/lib/ids.ts                    isUuid, so a bad URL stays a 404
src/components/skeleton.tsx
```

The icon is a fuel drop divided down the middle, generated at 192, 512, 512
maskable, 180 for iOS and 512 for the favicon. Re-run `npm run icons` after
changing the mark rather than editing five files.

`/cars/does-not-exist` used to show "something went wrong", because Postgres
raises on a malformed uuid instead of returning no rows. It is a 404 now, the
same answer as a car that exists but is not yours.

Still to do before this counts as a finished PWA: no service worker, so there is
no offline behaviour at all. That is a deliberate omission — the app is useless
without the database anyway, and a cache that serves stale kilometres would be
worse than an error.

### Step 7 — deployed

Live at **https://gas-split-app.vercel.app**, from
**github.com/edomarte/GasSplitApp** on every push to `main`.

Vercel environment variables mirror `.env.local`, with `NEXT_PUBLIC_SITE_URL`
set to the production domain. Note that `NEXT_PUBLIC_*` is inlined at build
time: changing one needs a redeploy, not just a save.

Two things caught on the deployed site:
- Deployment Protection is on by default and put every route, including the
  manifest, behind Vercel's SSO. It has to be off for Production or invite links
  and QR codes reach nobody.
- The first deployment URL contains a per-build hash and changes on every push.
  Only the stable `*.vercel.app` alias belongs in `NEXT_PUBLIC_SITE_URL`.

Verified in production: sign-in, the protected-route redirect with `?next=`, the
members and history pages, invite creation with a correctly-formed link, the
manifest and icons, and the mobile layout.

### Password reset (done)
`/account/password` serves both a reset link and a deliberate change: the link
signs the user in, so by the time the page renders the two are the same thing.
No current-password field, because the reset case has none to offer. The header
links to it, and stays reachable on a phone — the email is hidden below `sm`,
so it shows "Account" there instead.

### Still open
- Notifications are proven end to end over Gmail SMTP: an invite email and a
  three-way settlement were both delivered. Set the five `SMTP_*` / `EMAIL_FROM`
  variables on Vercel too, or production still reports `skipped`.
- Mail is sent from a personal Gmail account. Every invite and settlement shows
  that address as the sender and replies go there, which suits a shared car and
  would not suit anything larger. Gmail's limit is roughly 500 a day.
- "Confirm email" is off, which leaks which addresses have accounts at signup.
- Scanning a QR with a real camera is the one path never exercised; it needs a
  phone and a second screen.
- Test data lives on the production project: Fiat Panda, three `edomarte+*`
  accounts, and Giulia's own car.
