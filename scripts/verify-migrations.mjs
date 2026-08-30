/**
 * Applies every migration in supabase/migrations to a throwaway Postgres and
 * asserts the result, so schema mistakes surface without Docker or a project.
 *
 * PGlite is real Postgres compiled to WebAssembly. What it does not have is
 * Supabase's `auth` schema, so this file stubs the parts the migrations touch:
 * the roles, `auth.users`, and `auth.uid()` reading a session setting. That
 * stub is also what lets the RLS tests below impersonate a member.
 *
 *   npm run db:verify
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Mirrors just enough of a Supabase database for the migrations to apply. */
const SUPABASE_STUB = `
  create role anon;
  create role authenticated;
  create role service_role;

  create schema if not exists auth;

  create table auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text,
    raw_user_meta_data  jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now()
  );

  -- Supabase reads the user id out of the request JWT. Here a session setting
  -- stands in for it, so tests can switch identity with set_config().
  create function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  -- Supabase grants these; without them every policy that calls auth.uid()
  -- fails with "permission denied for schema auth" rather than returning false.
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ${green("PASS")} ${label}`);
  } else {
    failures += 1;
    console.log(`  ${red("FAIL")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
  }
}

/** Runs `fn` as the given user with the `authenticated` role, as PostgREST would. */
async function asUser(db, userId, fn) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.exec("set local role authenticated");
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

/** Resolves to the error Postgres raised, or null if the statement succeeded. */
async function errorFrom(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function main() {
  const db = await PGlite.create();

  console.log("\nStubbing the Supabase auth schema");
  await db.exec(SUPABASE_STUB);
  console.log(`  ${green("PASS")} roles, auth.users and auth.uid() created`);

  console.log("\nApplying migrations");
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
      console.log(`  ${green("PASS")} ${file}`);
    } catch (error) {
      failures += 1;
      console.log(`  ${red("FAIL")} ${file}`);
      console.log(`         ${red(error.message)}`);
      // A failed migration invalidates everything after it.
      console.log(`\n${red("Migration failed — stopping.")}\n`);
      process.exit(1);
    }
  }

  await runStructureChecks(db);
  const seed = await runBehaviourChecks(db);
  await runRlsChecks(db, seed);

  await db.close();

  console.log(
    failures === 0
      ? `\n${green("All checks passed.")}\n`
      : `\n${red(`${failures} check(s) failed.`)}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function runStructureChecks(db) {
  console.log("\nStructure");

  const expectedTables = [
    "cars",
    "fill_shares",
    "fills",
    "invites",
    "memberships",
    "profiles",
    "trip_shares",
    "trips",
  ];

  const { rows: tables } = await db.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const names = tables.map((r) => r.tablename);
  for (const table of expectedTables) {
    check(`table ${table} exists`, names.includes(table));
  }

  const { rows: unprotected } = await db.query(
    `select tablename from pg_tables
     where schemaname = 'public' and not rowsecurity
     order by tablename`,
  );
  check(
    "row level security is enabled on every public table",
    unprotected.length === 0,
    unprotected.map((r) => r.tablename).join(", "),
  );

  // A table with RLS on and no policy is invisible to everyone, which is a
  // silent, confusing failure. Only assert on tables meant to be readable.
  const { rows: policyCounts } = await db.query(
    `select c.relname as table, count(p.policyname) as policies
     from pg_tables c2
     join pg_class c on c.relname = c2.tablename
     left join pg_policies p on p.tablename = c2.tablename and p.schemaname = 'public'
     where c2.schemaname = 'public'
     group by c.relname
     order by c.relname`,
  );
  for (const row of policyCounts) {
    check(`${row.table} has at least one policy`, Number(row.policies) > 0);
  }

  const { rows: views } = await db.query(
    `select viewname from pg_views where schemaname = 'public' order by viewname`,
  );
  const viewNames = views.map((r) => r.viewname);
  check("view open_period_km exists", viewNames.includes("open_period_km"));
  check("view car_odometer exists", viewNames.includes("car_odometer"));

  // A security definer view would leak other cars' data past RLS.
  const { rows: invoker } = await db.query(
    `select c.relname, c.reloptions
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'`,
  );
  for (const view of invoker) {
    check(
      `view ${view.relname} runs with security_invoker`,
      (view.reloptions ?? []).some((o) => o.replace(/\s/g, "") === "security_invoker=on"),
      JSON.stringify(view.reloptions),
    );
  }
}

async function runBehaviourChecks(db) {
  console.log("\nBehaviour");

  // Seed two users; the triggers should mirror them into profiles.
  const {
    rows: [alice],
  } = await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('alice@example.com', '{"full_name": "Alice Rossi"}'::jsonb)
     returning id`,
  );
  const {
    rows: [bob],
  } = await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('bob@example.com', '{}'::jsonb) returning id`,
  );

  const { rows: profiles } = await db.query(
    `select id, display_name from public.profiles order by display_name`,
  );
  check("a profile is created for each new auth user", profiles.length === 2);
  check(
    "display_name comes from provider metadata",
    profiles.some((p) => p.display_name === "Alice Rossi"),
  );
  check(
    "display_name falls back to the email local part",
    profiles.some((p) => p.display_name === "bob"),
    JSON.stringify(profiles.map((p) => p.display_name)),
  );

  await db.query(
    `update auth.users set raw_user_meta_data = '{"full_name": "Alice Bianchi"}'::jsonb
     where id = $1`,
    [alice.id],
  );
  const {
    rows: [renamed],
  } = await db.query(`select display_name from public.profiles where id = $1`, [alice.id]);
  check("renaming in auth.users updates the profile", renamed.display_name === "Alice Bianchi");

  const {
    rows: [car],
  } = await db.query(
    `insert into public.cars (name, created_by, initial_odometer_km)
     values ('Panda', $1, 50000) returning id`,
    [alice.id],
  );
  const { rows: memberships } = await db.query(
    `select user_id, role from public.memberships where car_id = $1`,
    [car.id],
  );
  check(
    "creating a car makes the creator its owner",
    memberships.length === 1 &&
      memberships[0].user_id === alice.id &&
      memberships[0].role === "owner",
  );

  const {
    rows: [odo],
  } = await db.query(`select last_km from public.car_odometer where car_id = $1`, [car.id]);
  check(
    "car_odometer starts at the initial reading",
    Number(odo.last_km) === 50000,
    `got ${odo?.last_km}`,
  );

  // A trip with no participants must not be storable.
  const orphan = await errorFrom(
    db.exec(`
      begin;
      insert into public.trips (car_id, recorded_by, start_km, end_km, driven_on)
      values ('${car.id}', '${alice.id}', 50000, 50100, current_date);
      commit;
    `),
  );
  check(
    "a trip with no participants is rejected at commit",
    orphan !== null && /no participants/.test(orphan.message),
    orphan?.message ?? "the insert was accepted",
  );
  await db.exec("rollback").catch(() => {});

  const backwards = await errorFrom(
    db.query(
      `insert into public.trips (car_id, recorded_by, start_km, end_km, driven_on)
       values ($1, $2, 50100, 50000, current_date)`,
      [car.id, alice.id],
    ),
  );
  check(
    "a trip ending before it started is rejected",
    backwards !== null && /trips_distance_positive/.test(backwards.message),
    backwards?.message ?? "the insert was accepted",
  );
  await db.exec("rollback").catch(() => {});

  await db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [
    car.id,
    bob.id,
  ]);

  // One solo 100 km trip and one 100 km trip split two ways.
  await db.exec(`
    begin;
    insert into public.trips (id, car_id, recorded_by, start_km, end_km, driven_on)
    values ('11111111-1111-1111-1111-111111111111', '${car.id}', '${alice.id}',
            50000, 50100, current_date);
    insert into public.trip_shares (trip_id, user_id)
    values ('11111111-1111-1111-1111-111111111111', '${alice.id}');

    insert into public.trips (id, car_id, recorded_by, start_km, end_km, driven_on)
    values ('22222222-2222-2222-2222-222222222222', '${car.id}', '${alice.id}',
            50100, 50200, current_date);
    insert into public.trip_shares (trip_id, user_id) values
      ('22222222-2222-2222-2222-222222222222', '${alice.id}'),
      ('22222222-2222-2222-2222-222222222222', '${bob.id}');
    commit;
  `);

  const { rows: km } = await db.query(
    `select user_id, km from public.open_period_km where car_id = $1`,
    [car.id],
  );
  const aliceKm = Number(km.find((r) => r.user_id === alice.id)?.km);
  const bobKm = Number(km.find((r) => r.user_id === bob.id)?.km);
  check("a solo trip plus half a split trip is 150 km", aliceKm === 150, `got ${aliceKm}`);
  check("the other half of the split trip is 50 km", bobKm === 50, `got ${bobKm}`);

  const {
    rows: [odo2],
  } = await db.query(`select last_km from public.car_odometer where car_id = $1`, [car.id]);
  check("car_odometer follows the highest reading", Number(odo2.last_km) === 50200);

  // Settling the period should empty the dashboard without deleting anything.
  const {
    rows: [fill],
  } = await db.query(
    `insert into public.fills (car_id, paid_by, total_cents, filled_on)
     values ($1, $2, 7240, current_date) returning id`,
    [car.id, alice.id],
  );
  await db.query(`update public.trips set fill_id = $1 where car_id = $2 and fill_id is null`, [
    fill.id,
    car.id,
  ]);

  const { rows: afterSettle } = await db.query(
    `select * from public.open_period_km where car_id = $1`,
    [car.id],
  );
  check("settling a fill empties the open period", afterSettle.length === 0);

  const {
    rows: [kept],
  } = await db.query(`select count(*)::int as n from public.trips where car_id = $1`, [car.id]);
  check("settled trips are kept, not deleted", kept.n === 2, `got ${kept.n}`);

  return { alice: alice.id, bob: bob.id, car: car.id };
}

async function runRlsChecks(db, { alice, car }) {
  console.log("\nRow level security");

  // An outsider with a valid session must see nothing of this car.
  const {
    rows: [mallory],
  } = await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('mallory@example.com', '{}'::jsonb) returning id`,
  );

  await asUser(db, mallory.id, async () => {
    const { rows: cars } = await db.query(`select id from public.cars`);
    check("a non-member sees no cars", cars.length === 0, `saw ${cars.length}`);

    const { rows: trips } = await db.query(`select id from public.trips`);
    check("a non-member sees no trips", trips.length === 0, `saw ${trips.length}`);

    const { rows: seen } = await db.query(`select id from public.profiles`);
    check(
      "a non-member sees only their own profile",
      seen.length === 1 && seen[0].id === mallory.id,
      `saw ${seen.length}`,
    );

    const { rows: fills } = await db.query(`select id from public.fills`);
    check("a non-member sees no fills", fills.length === 0, `saw ${fills.length}`);
  });

  await asUser(db, alice, async () => {
    const { rows: cars } = await db.query(`select id from public.cars`);
    check("a member sees their car", cars.length === 1 && cars[0].id === car);

    const { rows: profiles } = await db.query(`select id from public.profiles`);
    check(
      "a member sees their co-members",
      profiles.length === 2,
      `saw ${profiles.length}, expected alice and bob`,
    );

    // Settlement must go through a definer function, never a direct write.
    const direct = await errorFrom(
      db.query(
        `insert into public.fills (car_id, paid_by, total_cents, filled_on)
         values ($1, $2, 1000, current_date)`,
        [car, alice],
      ),
    );
    // Either mechanism is a correct denial: the missing grant stops it first,
    // and the absent insert policy would stop it even if the grant existed.
    check(
      "a member cannot insert a fill directly",
      direct !== null && /(row-level security|permission denied)/.test(direct.message),
      direct?.message ?? "the insert was accepted",
    );
  });

  // Settled trips are evidence behind an email that already went out.
  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `update public.trips set end_km = 99999 where car_id = $1 returning id`,
      [car],
    );
    check("settled trips cannot be edited", rows.length === 0, `updated ${rows.length}`);
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(`delete from public.trips where car_id = $1 returning id`, [
      car,
    ]);
    check("settled trips cannot be deleted", rows.length === 0, `deleted ${rows.length}`);
  });
}

main().catch((error) => {
  console.error(`\n${red("Verification crashed:")} ${error.message}\n`);
  process.exit(1);
});
