import { asMember, recordTrip } from "./record-trip.mjs";

/**
 * Settlement.
 *
 * The only place kilometres become money, so these checks are about arithmetic
 * as much as permissions. The property that matters more than any individual
 * figure: the shares always sum to exactly what was paid.
 */
export async function runSettlementChecks(
  db,
  { alice, bob, outsider },
  { check, asUser, errorFrom },
) {
  console.log("\nSettlement");

  const makeCar = async (name, members) => {
    const {
      rows: [car],
    } = await db.query(
      `insert into public.cars (name, created_by) values ($1, $2) returning id`,
      [name, alice],
    );
    for (const person of members) {
      await db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [
        car.id,
        person,
      ]);
    }
    return car.id;
  };

  /**
   * Records a trip as `who`, the way the app does: alone through add_trip,
   * shared through a proposal everybody accepts. The settlement never sees the
   * difference — it reads `trips` — but seeding it any other way would test a
   * path the app no longer has.
   */
  const trip = (carId, who, startKm, endKm, participants = null) =>
    recordTrip(db, { carId, recordedBy: who, startKm, endKm, participants });

  const settle = async (carId, who, cents, paidBy = null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who]);
    await db.exec(`set role authenticated`);
    try {
      const {
        rows: [row],
      } = await db.query(
        `select public.settle_fill($1, $2, current_date, $3::uuid, null) as result`,
        [carId, cents, paidBy],
      );
      return row.result;
    } finally {
      await db.exec(`reset role`);
    }
  };

  // --- an even split -------------------------------------------------------

  const evenCar = await makeCar("Even", [bob]);
  await trip(evenCar, alice, 0, 100);
  await trip(evenCar, bob, 100, 200);

  const even = await settle(evenCar, alice, 5000);
  check("an even split settles", even.status === "ok", JSON.stringify(even));
  check(
    "two equal drivers each pay half",
    even.shares.every((s) => s.amount_cents === 2500),
    JSON.stringify(even.shares),
  );

  // --- the split that does not divide --------------------------------------

  const oddCar = await makeCar("Odd", [bob, outsider]);
  await trip(oddCar, alice, 0, 100, [bob, outsider]); // 100 km three ways

  // 1000 cents over three equal shares: 333.33 each.
  const odd = await settle(oddCar, alice, 1000);
  check("a three-way split settles", odd.status === "ok", JSON.stringify(odd));

  const oddTotal = odd.shares.reduce((sum, s) => sum + s.amount_cents, 0);
  check(
    "three equal shares of 10.00 still sum to 10.00",
    oddTotal === 1000,
    `summed to ${oddTotal} from ${JSON.stringify(odd.shares.map((s) => s.amount_cents))}`,
  );
  check(
    "the leftover cent goes to exactly one person",
    odd.shares.filter((s) => s.amount_cents === 334).length === 1 &&
      odd.shares.filter((s) => s.amount_cents === 333).length === 2,
    JSON.stringify(odd.shares.map((s) => s.amount_cents)),
  );

  // --- a mixed period, where the scaling actually matters ------------------

  const mixedCar = await makeCar("Mixed", [bob, outsider]);
  await trip(mixedCar, alice, 0, 100); // alice solo, 100
  await trip(mixedCar, bob, 100, 250, [outsider]); // bob + outsider, 75 each
  await trip(mixedCar, alice, 250, 400, [bob, outsider]); // 50 each

  // alice 150, bob 125, outsider 125; total 400.
  const mixed = await settle(mixedCar, alice, 7240);
  check("a period mixing solo, two-way and three-way settles", mixed.status === "ok");
  check(
    "the scale is the lowest common multiple of the participant counts",
    Number(mixed.km_scale) === 6,
    `scale was ${mixed.km_scale}`,
  );

  const mixedTotal = mixed.shares.reduce((sum, s) => sum + s.amount_cents, 0);
  check("the mixed split sums to the exact amount paid", mixedTotal === 7240, `got ${mixedTotal}`);

  const byUser = Object.fromEntries(mixed.shares.map((s) => [s.user_id, s.amount_cents]));
  // 150/400 of 7240 = 2715; 125/400 = 2262.5 -> 2263 and 2262.
  check(
    "the furthest driver pays the largest share",
    byUser[alice] === 2715,
    `alice paid ${byUser[alice]}`,
  );
  check(
    "the two equal drivers differ by at most the leftover cent",
    Math.abs(byUser[bob] - byUser[outsider]) <= 1,
    `${byUser[bob]} vs ${byUser[outsider]}`,
  );

  // --- closing the period --------------------------------------------------

  const { rows: stillOpen } = await db.query(
    `select id from public.trips where car_id = $1 and fill_id is null`,
    [mixedCar],
  );
  check("settling closes the period", stillOpen.length === 0, `${stillOpen.length} left open`);

  const { rows: kept } = await db.query(`select id from public.trips where car_id = $1`, [
    mixedCar,
  ]);
  check("the trips behind the split are kept", kept.length === 3, `got ${kept.length}`);

  const { rows: dashboard } = await db.query(
    `select * from public.open_period_km where car_id = $1`,
    [mixedCar],
  );
  check("the dashboard is empty afterwards", dashboard.length === 0);

  const again = await settle(mixedCar, alice, 1000);
  check(
    "settling twice in a row finds nothing to settle",
    again.status === "no_trips",
    JSON.stringify(again),
  );

  // --- refusals ------------------------------------------------------------

  const emptyCar = await makeCar("Empty", []);
  const nothing = await settle(emptyCar, alice, 5000);
  check(
    "a fill cannot be recorded with no trips to split",
    nothing.status === "no_trips",
    JSON.stringify(nothing),
  );

  const freeCar = await makeCar("Free", [bob]);
  await trip(freeCar, alice, 0, 50);
  const free = await settle(freeCar, alice, 0);
  check("a fill of nothing is refused", free.status === "bad_amount", JSON.stringify(free));

  const negative = await settle(freeCar, alice, -500);
  check("a negative fill is refused", negative.status === "bad_amount", JSON.stringify(negative));

  const intruder = await settle(freeCar, outsider, 5000);
  check(
    "a non-member cannot settle a car",
    intruder.status === "not_member",
    JSON.stringify(intruder),
  );

  const wrongPayer = await settle(freeCar, alice, 5000, outsider);
  check(
    "the money cannot be owed to someone outside the car",
    wrongPayer.status === "payer_not_member",
    JSON.stringify(wrongPayer),
  );

  // --- the ledger is not writable by hand ----------------------------------

  // Denied either by the missing grant or by the absent policy. Both are
  // correct; the ledger simply is not writable from a client.
  await asUser(db, alice, async () => {
    const denied = await errorFrom(
      db.query(`update public.fill_shares set amount_cents = 1 returning fill_id`),
    );
    check(
      "a member cannot rewrite what they owe",
      denied !== null,
      denied?.message ?? "the update was accepted",
    );
  });

  await asUser(db, alice, async () => {
    const denied = await errorFrom(db.query(`delete from public.fills returning id`));
    check(
      "a member cannot delete a settlement",
      denied !== null,
      denied?.message ?? "the delete was accepted",
    );
  });

  // --- what a member can read ---------------------------------------------

  await asUser(db, bob, async () => {
    const { rows } = await db.query(
      `select fs.amount_cents from public.fill_shares fs
       join public.fills f on f.id = fs.fill_id
       where f.car_id = $1`,
      [mixedCar],
    );
    check(
      "a member can see the whole breakdown, not only their own share",
      rows.length === 3,
      `saw ${rows.length}`,
    );
  });

  await asUser(db, outsider, async () => {
    const { rows } = await db.query(
      `select id from public.fills where car_id = $1`,
      [evenCar],
    );
    check("a non-member sees no fills", rows.length === 0, `saw ${rows.length}`);
  });

  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);

  return { mixedCar };
}

/**
 * The property that matters most, over a wide spread of amounts and splits:
 * money is never lost or invented, and nobody is more than a cent from their
 * exact share.
 */
export async function runSettlementPropertyChecks(db, { alice, bob, outsider }, { check }) {
  console.log("\nSettlement arithmetic");

  let worstDrift = 0;
  let failures = 0;
  let cases = 0;

  for (const cents of [1, 7, 99, 100, 1000, 3333, 7240, 999999]) {
    for (const shape of [
      { label: "solo", legs: [[100, null]] },
      { label: "two-way", legs: [[100, [bob]]] },
      { label: "three-way", legs: [[100, [bob, outsider]]] },
      { label: "mixed", legs: [[100, null], [150, [bob]], [150, [bob, outsider]]] },
      { label: "lopsided", legs: [[997, null], [3, [bob, outsider]]] },
    ]) {
      cases += 1;

      const {
        rows: [car],
      } = await db.query(
        `insert into public.cars (name, created_by) values ($1, $2) returning id`,
        [`Prop ${cases}`, alice],
      );
      for (const person of [bob, outsider]) {
        await db.query(`insert into public.memberships (car_id, user_id) values ($1, $2)`, [
          car.id,
          person,
        ]);
      }

      let odometer = 0;
      for (const [distance, participants] of shape.legs) {
        await recordTrip(db, {
          carId: car.id,
          recordedBy: alice,
          startKm: odometer,
          endKm: odometer + distance,
          participants,
        });
        odometer += distance;
      }

      const result = await asMember(db, alice, async () => {
        const {
          rows: [row],
        } = await db.query(
          `select public.settle_fill($1, $2, current_date, null, null) as result`,
          [car.id, cents],
        );
        return row.result;
      });

      if (result.status !== "ok") {
        failures += 1;
        continue;
      }

      const sum = result.shares.reduce((total, s) => total + s.amount_cents, 0);
      if (sum !== cents) failures += 1;

      const weightTotal = result.shares.reduce((total, s) => total + Number(s.km_scaled), 0);
      for (const share of result.shares) {
        const exact = (Number(share.km_scaled) / weightTotal) * cents;
        worstDrift = Math.max(worstDrift, Math.abs(share.amount_cents - exact));
      }
    }
  }

  check(
    `every one of ${cases} splits sums to exactly what was paid`,
    failures === 0,
    `${failures} did not`,
  );
  check(
    "nobody is ever more than one cent from their exact share",
    worstDrift < 1,
    `worst drift was ${worstDrift.toFixed(4)} cents`,
  );

  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}
