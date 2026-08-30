/**
 * Departed members, and splits that do not divide evenly.
 *
 * Both feed the settlement directly. Kilometres belonging to nobody would become
 * money belonging to nobody, and a three-way split is where exact arithmetic
 * stops agreeing with decimals.
 */
export async function runFormerMemberChecks(db, { alice, bob, outsider }, { check, asUser }) {
  console.log("\nFormer members and uneven splits");

  const {
    rows: [car],
  } = await db.query(
    `insert into public.cars (name, created_by) values ('Leaver Car', $1) returning id`,
    [alice],
  );
  for (const person of [bob, outsider]) {
    await db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [
      car.id,
      person,
    ]);
  }

  const asMember = async (userId, sql, params = []) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    await db.exec(`set role authenticated`);
    try {
      const { rows } = await db.query(sql, params);
      return rows[0]?.result;
    } finally {
      await db.exec(`reset role`);
    }
  };

  // --- a three-way split, which does not divide evenly ----------------------

  await asMember(
    alice,
    `select public.add_trip($1, 0, 100, current_date, array[$2, $3]::uuid[], null) as result`,
    [car.id, bob, outsider],
  );

  const { rows: threeWay } = await db.query(
    `select user_id, km from public.open_period_km where car_id = $1`,
    [car.id],
  );
  check(
    "a three-way split gives all three participants a share",
    threeWay.length === 3,
    `got ${threeWay.length}`,
  );

  const total = threeWay.reduce((sum, row) => sum + Number(row.km), 0);
  check(
    "the three shares still add back up to the whole trip",
    Math.abs(total - 100) < 0.0001,
    `summed to ${total}`,
  );
  check(
    "each of the three carries a third of the distance",
    threeWay.every((row) => Math.abs(Number(row.km) - 100 / 3) < 0.0001),
    JSON.stringify(threeWay.map((r) => Number(r.km))),
  );

  // --- someone leaves mid-period -------------------------------------------

  await db.query(`delete from public.memberships where car_id = $1 and user_id = $2`, [
    car.id,
    outsider,
  ]);

  const { rows: afterLeaving } = await db.query(
    `select user_id, km from public.open_period_km where car_id = $1`,
    [car.id],
  );
  check(
    "a departed member keeps the kilometres they drove",
    afterLeaving.length === 3,
    `got ${afterLeaving.length}`,
  );

  const stillTotals = afterLeaving.reduce((sum, row) => sum + Number(row.km), 0);
  check(
    "the period still accounts for the whole distance after someone leaves",
    Math.abs(stillTotals - 100) < 0.0001,
    `summed to ${stillTotals}`,
  );

  // The point of the migration: without it the dashboard has kilometres it
  // cannot put a name to, and the settlement would have money to match.
  await asUser(db, alice, async () => {
    const { rows } = await db.query(`select id, display_name from public.profiles where id = $1`, [
      outsider,
    ]);
    check(
      "a remaining member can still read the departed member's name",
      rows.length === 1 && Boolean(rows[0].display_name),
      `saw ${rows.length}`,
    );
  });

  // --- editing a trip a departed member was on ------------------------------

  const {
    rows: [trip],
  } = await db.query(`select id from public.trips where car_id = $1 limit 1`, [car.id]);

  const kept = await asMember(
    alice,
    `select public.update_trip($1, 0, 150, current_date, array[$2, $3]::uuid[], null) as result`,
    [trip.id, bob, outsider],
  );
  check(
    "a trip can still be edited with a departed member left on it",
    kept?.status === "ok",
    JSON.stringify(kept),
  );

  const { rows: keptShares } = await db.query(
    `select user_id from public.trip_shares where trip_id = $1`,
    [trip.id],
  );
  check(
    "the departed member is still on the trip afterwards",
    keptShares.some((row) => row.user_id === outsider),
    JSON.stringify(keptShares.map((r) => r.user_id)),
  );

  // A stranger who never drove is a different matter entirely.
  const {
    rows: [newcomer],
  } = await db.query(
    `insert into auth.users (email) values ('nobody@example.com') returning id`,
  );
  const refused = await asMember(
    alice,
    `select public.update_trip($1, 0, 150, current_date, array[$2]::uuid[], null) as result`,
    [trip.id, newcomer.id],
  );
  check(
    "someone who never drove still cannot be added to a trip",
    refused?.status === "not_all_members",
    JSON.stringify(refused),
  );

  // --- dropping a participant still works ----------------------------------

  const dropped = await asMember(
    alice,
    `select public.update_trip($1, 0, 150, current_date, array[]::uuid[], null) as result`,
    [trip.id],
  );
  check("participants can be removed", dropped?.status === "ok", JSON.stringify(dropped));

  const { rows: afterDrop } = await db.query(
    `select user_id from public.trip_shares where trip_id = $1`,
    [trip.id],
  );
  check(
    "dropping everyone leaves the trip with just its recorder",
    afterDrop.length === 1 && afterDrop[0].user_id === alice,
    JSON.stringify(afterDrop.map((r) => r.user_id)),
  );

  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}
