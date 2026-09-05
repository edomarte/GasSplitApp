import { recordTrip } from "./record-trip.mjs";

/**
 * Recording and editing trips.
 *
 * The aggregation these feed is what the whole settlement is computed from, so
 * the arithmetic is checked here as well as the permissions: a split trip must
 * divide exactly, and a settled trip must stay frozen.
 */
export async function runTripFunctionChecks(db, { alice, bob, outsider }, { check, asUser }) {
  console.log("\nTrip functions");

  const {
    rows: [car],
  } = await db.query(
    `insert into public.cars (name, created_by, initial_odometer_km)
     values ('Trip Car', $1, 1000) returning id`,
    [alice],
  );
  await db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [
    car.id,
    bob,
  ]);

  const addTrip = (userId, args) =>
    asUser(db, userId, async () => {
      const {
        rows: [row],
      } = await db.query(
        `select public.add_trip($1, $2, $3, $4, $5::uuid[], $6) as result`,
        args,
      );
      return row.result;
    });

  // --- the shape that two PostgREST calls cannot produce --------------------

  let soloTripId;
  await asUser(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.add_trip($1, 1000, 1100, current_date, null, 'To the coast') as result`,
      [car.id],
    );
    check("a solo trip is recorded", result.status === "ok", JSON.stringify(result));
    soloTripId = result.trip_id;

    const { rows: shares } = await db.query(
      `select user_id from public.trip_shares where trip_id = $1`,
      [result.trip_id],
    );
    check(
      "the recorder is the only participant of a solo trip",
      shares.length === 1 && shares[0].user_id === alice,
      JSON.stringify(shares),
    );
  });

  // asUser rolls back, so commit the seed data this run needs.
  const solo = await recordTrip(db, {
    carId: car.id,
    recordedBy: alice,
    startKm: 1000,
    endKm: 1100,
  });
  soloTripId = solo.trip_id;

  // A shared drive is no longer something add_trip can produce: it is a
  // proposal that the other person accepts. recordTrip does both.
  const split = await recordTrip(db, {
    carId: car.id,
    recordedBy: alice,
    startKm: 1100,
    endKm: 1200,
    participants: [bob],
  });
  check("a split trip is recorded once it is agreed", split.status === "ok", JSON.stringify(split));

  const uninvited = await addTrip(alice, [car.id, 1200, 1300, "2026-08-30", [bob], null]);
  check(
    "add_trip will not put anyone but the caller on a trip",
    uninvited.status === "needs_confirmation",
    JSON.stringify(uninvited),
  );

  const { rows: splitShares } = await db.query(
    `select user_id from public.trip_shares where trip_id = $1 order by user_id`,
    [split.trip_id],
  );
  check(
    "a split trip has both the recorder and the person they split with",
    splitShares.length === 2,
    `got ${splitShares.length}`,
  );

  // --- the arithmetic the settlement will rely on ---------------------------

  const { rows: km } = await db.query(
    `select user_id, km from public.open_period_km where car_id = $1`,
    [car.id],
  );
  const aliceKm = Number(km.find((r) => r.user_id === alice)?.km);
  const bobKm = Number(km.find((r) => r.user_id === bob)?.km);
  check("the driver of a solo trip carries all of it", aliceKm === 150, `got ${aliceKm}`);
  check("a two-way split halves the distance", bobKm === 50, `got ${bobKm}`);

  // --- validation ----------------------------------------------------------

  const backwards = await addTrip(alice, [car.id, 1200, 1100, "2026-08-30", null, null]);
  check(
    "a trip that ends before it starts is refused",
    backwards.status === "bad_distance",
    JSON.stringify(backwards),
  );

  const zero = await addTrip(alice, [car.id, 1200, 1200, "2026-08-30", null, null]);
  check("a zero-length trip is refused", zero.status === "bad_distance", JSON.stringify(zero));

  const future = await asUser(db, alice, async () => {
    const {
      rows: [row],
    } = await db.query(
      `select public.add_trip($1, 1200, 1300, current_date + 30, null, null) as result`,
      [car.id],
    );
    return row.result;
  });
  check("a trip dated far in the future is refused", future.status === "future_date");

  const stranger = await addTrip(alice, [car.id, 1200, 1300, "2026-08-30", [outsider], null]);
  check(
    "a trip cannot be split with someone outside the car",
    stranger.status === "needs_confirmation",
    JSON.stringify(stranger),
  );

  const intruder = await addTrip(outsider, [car.id, 1200, 1300, "2026-08-30", null, null]);
  check(
    "a non-member cannot record a trip",
    intruder.status === "not_member",
    JSON.stringify(intruder),
  );

  // --- editing -------------------------------------------------------------

  await asUser(db, bob, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.update_trip($1, 1000, 1500, current_date, null, null) as result`,
      [soloTripId],
    );
    check(
      "a member cannot edit someone else's trip",
      result.status === "not_yours",
      JSON.stringify(result),
    );
  });

  await asUser(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.update_trip($1, 1000, 1300, current_date, array[$2]::uuid[], 'Longer') as result`,
      [soloTripId, bob],
    );
    // Editing was the other way to charge somebody quietly: record a solo trip,
    // then add them to it afterwards.
    check(
      "nobody new can be brought onto a trip by editing it",
      result.status === "needs_confirmation",
      JSON.stringify(result),
    );
  });

  await asUser(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.update_trip($1, 1000, 1300, current_date, null, 'Longer') as result`,
      [soloTripId],
    );
    check("the recorder can edit their own trip", result.status === "ok", JSON.stringify(result));

    const { rows: shares } = await db.query(
      `select user_id from public.trip_shares where trip_id = $1`,
      [soloTripId],
    );
    check(
      "a solo trip stays solo through an edit",
      shares.length === 1 && shares[0].user_id === alice,
      JSON.stringify(shares.map((r) => r.user_id)),
    );

    const { rows: rows2 } = await db.query(
      `select distance_km from public.trips where id = $1`,
      [soloTripId],
    );
    check("the stored distance follows the new readings", rows2[0].distance_km === 300);
  });

  // --- settled trips stay frozen -------------------------------------------

  const {
    rows: [fill],
  } = await db.query(
    `insert into public.fills (car_id, paid_by, total_cents, filled_on)
     values ($1, $2, 5000, current_date) returning id`,
    [car.id, alice],
  );
  await db.query(`update public.trips set fill_id = $1 where id = $2`, [fill.id, soloTripId]);

  await asUser(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.update_trip($1, 1000, 9999, current_date, null, null) as result`,
      [soloTripId],
    );
    check(
      "a settled trip cannot be edited",
      result.status === "settled",
      JSON.stringify(result),
    );
  });

  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}
