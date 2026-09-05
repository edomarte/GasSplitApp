# Gas Split

Track the kilometres each person drives in a shared car, and split the cost of
every fuel fill in proportion to what they drove.

Log a trip by its odometer readings, mark it as shared if someone came along,
and when the tank is filled the app closes the period, works out what each
person owes the payer, and emails them.

Nobody is charged for kilometres they did not agree to. A drive involving anyone
but the person recording it — a trip logged on somebody's behalf, or one shared
between several people — is a request until every other person on it confirms.

## How it works

A **period** is every trip since the last fill. Recording a fill does not delete
those trips — it stamps them with the fill's id, which both empties the
dashboard and keeps the evidence behind a split people were emailed about.

Distance is divided equally between the people on a trip, so a 100 km drive
shared three ways is 100/3 km each. That does not fit in a decimal, so the whole
period is scaled by the lowest common multiple of its participant counts, which
makes every weight a whole number. The cost is then divided by largest
remainder: everyone takes their whole cents and the leftovers go to whoever was
cut back hardest. **The shares always sum to exactly what was paid.**

Row level security is the authorization boundary. A query for "all cars"
returns only yours; a car id you are not a member of comes back empty, which is
why a stranger guessing an id gets the same 404 as a car that does not exist.
Joining a car and settling a fill are `security definer` functions, because
neither is expressible as a policy.

## Running it

```bash
npm install
```

Copy `.env.local.example` to `.env.local` and fill in a Supabase project's URL
and publishable key. Without them the app still starts and explains what is
missing rather than crashing.

```bash
npm run dev
```

## Checking your work

```bash
npm run test        # pure logic: the split arithmetic, money parsing, formatting
npm run db:verify   # applies every migration to Postgres-in-WebAssembly and
                    # asserts the schema, the RLS policies and the settlement
npm run typecheck
npm run lint
npm run build
```

`db:verify` needs no Docker, no network and no Supabase project — it runs the
real migrations against PGlite and checks, among other things, that a
non-member sees nothing and that no split ever loses or invents a cent.

## Layout

```
supabase/migrations/   the schema, the policies and the database functions
scripts/               db:verify and its check suites; icon generation
src/lib/               data access, and the pure modules the tests cover
src/app/               routes and server actions
src/components/        UI
```

`CLAUDE.md` records the decisions behind all of it, including the ones that were
reversed and why.

## Stack

Next.js 16 (App Router) · Supabase (Postgres, Auth, RLS) · Tailwind and
shadcn/ui · nodemailer over SMTP · deployed on Vercel.
