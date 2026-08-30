/**
 * Write policies, exercised on a car whose settlement period is still open.
 *
 * These are the rules steps 3 and 5 lean on, and none of them are reachable
 * from the read-only checks: the data seeded elsewhere is inserted as superuser,
 * which bypasses RLS entirely.
 *
 * A denied INSERT raises an error. A denied UPDATE or DELETE simply matches no
 * rows, so those are asserted on the returned row count instead.
 */
export async function runWritePolicyChecks(db, { alice, bob, outsider }, { check, asUser, errorFrom }) {
  console.log("\nWrite policies");

  const EXPIRY = "now() + interval '7 days'";

  // A second car, deliberately left unsettled. alice owns it, bob is a member.
  const {
    rows: [fresh],
  } = await db.query(
    `insert into public.cars (name, created_by) values ('Open Car', $1) returning id`,
    [alice],
  );
  const car = fresh.id;
  await db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [car, bob]);

  // The require-participants trigger is deferred to commit, so the trip and its
  // first share have to land in the same transaction.
  const trip = { id: "33333333-3333-3333-3333-333333333333" };
  await db.exec(`
    begin;
    insert into public.trips (id, car_id, recorded_by, start_km, end_km, driven_on)
    values ('${trip.id}', '${car}', '${alice}', 0, 10, current_date);
    insert into public.trip_shares (trip_id, user_id) values ('${trip.id}', '${alice}');
    commit;
  `);

  const {
    rows: [settled],
  } = await db.query(`select id from public.trips where fill_id is not null limit 1`);

  // --- trip_shares ---------------------------------------------------------

  await asUser(db, alice, async () => {
    const ok = await errorFrom(
      db.query(`insert into public.trip_shares (trip_id, user_id) values ($1, $2)`, [trip.id, bob]),
    );
    check("the recorder can split a trip with a fellow member", ok === null, ok?.message);
  });

  await asUser(db, alice, async () => {
    const denied = await errorFrom(
      db.query(`insert into public.trip_shares (trip_id, user_id) values ($1, $2)`, [
        trip.id,
        outsider,
      ]),
    );
    check(
      "a trip cannot be split with someone outside the car",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  await asUser(db, bob, async () => {
    const denied = await errorFrom(
      db.query(`insert into public.trip_shares (trip_id, user_id) values ($1, $2)`, [trip.id, bob]),
    );
    check(
      "a member cannot add participants to a trip they did not record",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  if (settled) {
    await asUser(db, alice, async () => {
      const denied = await errorFrom(
        db.query(`insert into public.trip_shares (trip_id, user_id) values ($1, $2)`, [
          settled.id,
          bob,
        ]),
      );
      check(
        "participants cannot be added to a settled trip",
        denied !== null,
        denied?.message ?? "the insert was accepted",
      );
    });
  }

  // --- invites -------------------------------------------------------------

  await asUser(db, alice, async () => {
    const ok = await errorFrom(
      db.query(
        `insert into public.invites (car_id, token_hash, created_by, expires_at)
         values ($1, 'hash-a', $2, ${EXPIRY})`,
        [car, alice],
      ),
    );
    check("a member can create an invite for their car", ok === null, ok?.message);
  });

  await asUser(db, alice, async () => {
    const denied = await errorFrom(
      db.query(
        `insert into public.invites (car_id, token_hash, created_by, expires_at)
         values ($1, 'hash-b', $2, ${EXPIRY})`,
        [car, bob],
      ),
    );
    check(
      "an invite cannot be attributed to another member",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  await asUser(db, outsider, async () => {
    const denied = await errorFrom(
      db.query(
        `insert into public.invites (car_id, token_hash, created_by, expires_at)
         values ($1, 'hash-c', $2, ${EXPIRY})`,
        [car, outsider],
      ),
    );
    check(
      "a non-member cannot invite anyone to the car",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  await db.query(
    `insert into public.invites (car_id, token_hash, created_by, expires_at)
     values ($1, 'hash-seed', $2, ${EXPIRY})`,
    [car, alice],
  );

  await asUser(db, bob, async () => {
    const { rows } = await db.query(`select id from public.invites where car_id = $1`, [car]);
    check("a member can see the invites for their car", rows.length === 1, `saw ${rows.length}`);
  });

  await asUser(db, outsider, async () => {
    const { rows } = await db.query(`select id from public.invites`);
    check("a non-member sees no invites", rows.length === 0, `saw ${rows.length}`);
  });

  await asUser(db, bob, async () => {
    const { rows } = await db.query(`delete from public.invites where car_id = $1 returning id`, [
      car,
    ]);
    check(
      "a member cannot revoke an invite they did not create",
      rows.length === 0,
      `deleted ${rows.length}`,
    );
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(`delete from public.invites where car_id = $1 returning id`, [
      car,
    ]);
    check("the inviter can revoke their own invite", rows.length === 1, `deleted ${rows.length}`);
  });

  // --- memberships ---------------------------------------------------------

  await asUser(db, alice, async () => {
    const denied = await errorFrom(
      db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [car, outsider]),
    );
    check(
      "nobody can add a member directly; joining needs the invite function",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  await asUser(db, bob, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, bob],
    );
    check("a member can leave a car", rows.length === 1, `deleted ${rows.length}`);
  });

  await asUser(db, bob, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, alice],
    );
    check("a member cannot remove the owner", rows.length === 0, `deleted ${rows.length}`);
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, bob],
    );
    check("an owner can remove a member", rows.length === 1, `deleted ${rows.length}`);
  });

  // --- cars ----------------------------------------------------------------

  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `update public.cars set name = 'Renamed' where id = $1 returning id`,
      [car],
    );
    check("an owner can rename the car", rows.length === 1, `updated ${rows.length}`);
  });

  await asUser(db, bob, async () => {
    const { rows } = await db.query(
      `update public.cars set name = 'Hijacked' where id = $1 returning id`,
      [car],
    );
    check("a member cannot rename the car", rows.length === 0, `updated ${rows.length}`);
  });

  await asUser(db, bob, async () => {
    const { rows } = await db.query(`delete from public.cars where id = $1 returning id`, [car]);
    check("a member cannot delete the car", rows.length === 0, `deleted ${rows.length}`);
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(`delete from public.cars where id = $1 returning id`, [car]);
    check("an owner can delete the car", rows.length === 1, `deleted ${rows.length}`);
  });

  await asUser(db, outsider, async () => {
    const denied = await errorFrom(
      db.query(`insert into public.cars (name, created_by) values ('Impostor', $1)`, [alice]),
    );
    check(
      "a car cannot be created on behalf of someone else",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });
}
