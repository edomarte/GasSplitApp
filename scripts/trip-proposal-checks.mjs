import { asMember, recordTrip } from "./record-trip.mjs";

/**
 * Trip proposals.
 *
 * The rule being enforced: nobody is charged for a drive they did not agree to.
 * That makes these checks as much about what CANNOT happen as what can — a
 * proposal that records a trip early, a response forged on somebody else's
 * behalf, a fill settled around an open question, or a member walking out and
 * leaving one behind.
 */
export async function runTripProposalChecks(
  db,
  { alice, bob, outsider },
  { check, asUser, errorFrom },
) {
  console.log("\nTrip proposals");

  const {
    rows: [carol],
  } = await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('carol@example.com', '{"full_name": "Carol"}'::jsonb) returning id`,
  );

  /** A car alice owns, with whoever else is named as members. */
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

  const propose = (who, carId, startKm, endKm, people, note = null) =>
    asMember(db, who, async () => {
      const {
        rows: [row],
      } = await db.query(
        `select public.propose_trip($1, $2, $3, current_date, $4::uuid[], $5) as result`,
        [carId, startKm, endKm, people, note],
      );
      return row.result;
    });

  const respond = (who, proposalId, accept) =>
    asMember(db, who, async () => {
      const {
        rows: [row],
      } = await db.query(`select public.respond_to_trip_proposal($1, $2) as result`, [
        proposalId,
        accept,
      ]);
      return row.result;
    });

  const cancel = (who, proposalId) =>
    asMember(db, who, async () => {
      const {
        rows: [row],
      } = await db.query(`select public.cancel_trip_proposal($1) as result`, [proposalId]);
      return row.result;
    });

  const sharesOf = async (tripId) => {
    const { rows } = await db.query(
      `select user_id from public.trip_shares where trip_id = $1 order by user_id`,
      [tripId],
    );
    return rows.map((r) => r.user_id);
  };

  // --- refusing to raise a pointless or dishonest one -----------------------

  const car = await makeCar("Proposal Car", [bob, carol.id]);

  const alone = await propose(alice, car, 0, 100, [alice]);
  check(
    "a proposal with nobody to ask is refused",
    alone.status === "no_one_to_ask",
    JSON.stringify(alone),
  );

  const stranger = await propose(alice, car, 0, 100, [bob, outsider]);
  check(
    "a drive cannot be pinned on somebody outside the car",
    stranger.status === "not_all_members",
    JSON.stringify(stranger),
  );

  const intruder = await propose(outsider, car, 0, 100, [alice]);
  check(
    "a non-member cannot propose anything",
    intruder.status === "not_member",
    JSON.stringify(intruder),
  );

  const backwards = await propose(alice, car, 100, 100, [bob]);
  check(
    "a zero-length proposal is refused",
    backwards.status === "bad_distance",
    JSON.stringify(backwards),
  );

  const future = await asMember(db, alice, async () => {
    const {
      rows: [row],
    } = await db.query(
      `select public.propose_trip($1, 0, 100, current_date + 30, $2::uuid[], null) as result`,
      [car, [bob]],
    );
    return row.result;
  });
  check("a proposal dated far in the future is refused", future.status === "future_date");

  // --- somebody else's solo drive ------------------------------------------

  const solo = await propose(alice, car, 0, 100, [bob], "You took it to the airport");
  check("a drive can be proposed for another member", solo.status === "ok", JSON.stringify(solo));
  check("the proposal says one person was asked", Number(solo.asked) === 1, JSON.stringify(solo));

  const { rows: earlyTrips } = await db.query(
    `select id from public.trips where car_id = $1`,
    [car],
  );
  check(
    "nothing is recorded while the proposal is pending",
    earlyTrips.length === 0,
    `found ${earlyTrips.length} trip(s)`,
  );

  const duplicate = await propose(alice, car, 0, 100, [bob]);
  check(
    "the same proposal cannot be raised twice while it is pending",
    duplicate.status === "duplicate",
    JSON.stringify(duplicate),
  );

  // --- the blocks, while it is pending -------------------------------------

  await recordTrip(db, { carId: car, recordedBy: alice, startKm: 500, endKm: 600 });

  await asUser(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.settle_fill($1, 5000, current_date, null, null) as result`,
      [car],
    );
    check(
      "a fill cannot be settled while a proposal is pending",
      result.status === "pending_proposals",
      JSON.stringify(result),
    );
  });

  await asUser(db, bob, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, bob],
    );
    check(
      "the person being asked cannot leave the car",
      rows.length === 0,
      `deleted ${rows.length}`,
    );
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, alice],
    );
    check("the person asking cannot leave either", rows.length === 0, `deleted ${rows.length}`);
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, bob],
    );
    check(
      "an owner cannot remove someone out of a pending question",
      rows.length === 0,
      `deleted ${rows.length}`,
    );
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `delete from public.memberships where car_id = $1 and user_id = $2 returning user_id`,
      [car, carol.id],
    );
    check(
      "somebody not involved can still leave",
      rows.length === 1,
      `deleted ${rows.length}`,
    );
  });

  // --- accepting ------------------------------------------------------------

  const accepted = await respond(bob, solo.proposal_id, true);
  check(
    "the person asked can accept",
    accepted.status === "ok" && accepted.outcome === "accepted",
    JSON.stringify(accepted),
  );

  const soloShares = await sharesOf(accepted.trip_id);
  check(
    "a drive proposed for one person belongs to that person alone",
    soloShares.length === 1 && soloShares[0] === bob,
    JSON.stringify(soloShares),
  );

  const {
    rows: [born],
  } = await db.query(
    `select recorded_by, proposal_id, distance_km from public.trips where id = $1`,
    [accepted.trip_id],
  );
  check(
    "the trip is attributed to whoever wrote it down",
    born.recorded_by === alice,
    born.recorded_by,
  );
  check("the trip remembers the proposal it came from", born.proposal_id === solo.proposal_id);
  check("the readings survive intact", born.distance_km === 100, `got ${born.distance_km}`);

  const {
    rows: [bobKm],
  } = await db.query(
    `select km from public.open_period_km where car_id = $1 and user_id = $2`,
    [car, bob],
  );
  check("the kilometres land on the driver", Number(bobKm.km) === 100, `got ${bobKm?.km}`);

  const twice = await respond(bob, solo.proposal_id, true);
  check(
    "answering a second time changes nothing",
    twice.status === "already_resolved",
    JSON.stringify(twice),
  );

  // --- a trip born of a proposal is frozen ---------------------------------

  await asUser(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.update_trip($1, 0, 900, current_date, null, null) as result`,
      [accepted.trip_id],
    );
    check(
      "the proposer cannot edit the trip afterwards",
      result.status === "from_proposal",
      JSON.stringify(result),
    );
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(
      `update public.trips set end_km = 9999 where id = $1 returning id`,
      [accepted.trip_id],
    );
    check(
      "and the policy refuses it even without the function",
      rows.length === 0,
      `updated ${rows.length}`,
    );
  });

  await asUser(db, alice, async () => {
    const { rows } = await db.query(`delete from public.trips where id = $1 returning id`, [
      accepted.trip_id,
    ]);
    check("but it can still be deleted", rows.length === 1, `deleted ${rows.length}`);
  });

  // --- everyone has to agree ------------------------------------------------

  const three = await makeCar("Three Way", [bob, carol.id]);
  const shared = await propose(alice, three, 0, 300, [alice, bob, carol.id]);
  check("a shared drive can be proposed", shared.status === "ok", JSON.stringify(shared));
  check(
    "the proposer is not asked to confirm their own presence",
    Number(shared.asked) === 2,
    JSON.stringify(shared),
  );

  const partial = await respond(bob, shared.proposal_id, true);
  check(
    "one acceptance is not enough",
    partial.status === "ok" && partial.outcome === "awaiting" && Number(partial.remaining) === 1,
    JSON.stringify(partial),
  );

  const { rows: stillNone } = await db.query(
    `select id from public.trips where car_id = $1`,
    [three],
  );
  check(
    "no trip exists while anyone is still to answer",
    stillNone.length === 0,
    `found ${stillNone.length}`,
  );

  const last = await respond(carol.id, shared.proposal_id, true);
  check(
    "the final acceptance records the trip",
    last.status === "ok" && last.outcome === "accepted",
    JSON.stringify(last),
  );

  const sharedShares = await sharesOf(last.trip_id);
  check(
    "all three are on it",
    sharedShares.length === 3,
    JSON.stringify(sharedShares),
  );

  const { rows: split } = await db.query(
    `select user_id, km from public.open_period_km where car_id = $1`,
    [three],
  );
  check(
    "300 km three ways is 100 km each",
    split.length === 3 && split.every((row) => Math.abs(Number(row.km) - 100) < 0.0001),
    JSON.stringify(split.map((r) => Number(r.km))),
  );

  // --- one rejection ends it ------------------------------------------------

  const refuse = await makeCar("Refusal", [bob, carol.id]);
  const contested = await propose(alice, refuse, 0, 300, [alice, bob, carol.id]);

  const rejected = await respond(bob, contested.proposal_id, false);
  check(
    "anyone on the drive can reject it",
    rejected.status === "ok" && rejected.outcome === "rejected",
    JSON.stringify(rejected),
  );

  const { rows: noTrip } = await db.query(`select id from public.trips where car_id = $1`, [
    refuse,
  ]);
  check("a rejected proposal records nothing", noTrip.length === 0, `found ${noTrip.length}`);

  const tooLate = await respond(carol.id, contested.proposal_id, true);
  check(
    "the others' question disappears with it",
    tooLate.status === "already_resolved",
    JSON.stringify(tooLate),
  );

  const {
    rows: [afterReject],
  } = await db.query(`select status, resolved_by from public.trip_proposals where id = $1`, [
    contested.proposal_id,
  ]);
  check(
    "the rejection is recorded against whoever made it",
    afterReject.status === "rejected" && afterReject.resolved_by === bob,
    JSON.stringify(afterReject),
  );

  // --- only the people on the drive may answer ------------------------------

  const outside = await makeCar("Bystander", [bob, carol.id]);
  const between = await propose(alice, outside, 0, 100, [bob, carol.id]);

  const nosy = await respond(alice, between.proposal_id, true);
  check(
    "the proposer cannot answer for a drive they were not on",
    nosy.status === "not_a_participant",
    JSON.stringify(nosy),
  );

  const trespasser = await respond(outsider, between.proposal_id, true);
  check(
    "a non-member cannot answer at all",
    trespasser.status === "not_a_participant",
    JSON.stringify(trespasser),
  );

  // --- withdrawing ----------------------------------------------------------

  const notYours = await cancel(bob, between.proposal_id);
  check(
    "somebody else's proposal cannot be withdrawn",
    notYours.status === "not_yours",
    JSON.stringify(notYours),
  );

  const withdrawn = await cancel(alice, between.proposal_id);
  check(
    "the proposer can withdraw it",
    withdrawn.status === "ok" && withdrawn.outcome === "cancelled",
    JSON.stringify(withdrawn),
  );

  const gone = await respond(bob, between.proposal_id, true);
  check(
    "a withdrawn proposal cannot then be accepted",
    gone.status === "already_resolved",
    JSON.stringify(gone),
  );

  const again = await cancel(alice, between.proposal_id);
  check(
    "withdrawing twice is not a second event",
    again.status === "already_resolved",
    JSON.stringify(again),
  );

  // An owner's override. Without it one member who never opens the app blocks
  // the car's fills for good.
  const hostage = await makeCar("Hostage", [bob, carol.id]);
  const bobsProposal = await propose(bob, hostage, 0, 100, [carol.id]);
  const overridden = await cancel(alice, bobsProposal.proposal_id);
  check(
    "an owner can withdraw anyone's proposal",
    overridden.status === "ok",
    JSON.stringify(overridden),
  );

  await asMember(db, alice, async () => {
    const {
      rows: [{ result }],
    } = await db.query(
      `select public.settle_fill($1, 5000, current_date, null, null) as result`,
      [car],
    );
    check(
      "settling works again once nothing is pending",
      result.status === "ok",
      JSON.stringify(result),
    );
  });

  // --- what a client cannot do directly -------------------------------------

  const direct = await makeCar("Direct", [bob, carol.id]);
  const target = await propose(alice, direct, 0, 100, [bob]);

  // Neither table is granted update or delete at all, so these are refused
  // before any policy is consulted. That is the intended shape: the only way a
  // response exists is the function that also writes the trip.
  await asUser(db, bob, async () => {
    const denied = await errorFrom(
      db.query(
        `update public.trip_proposal_participants set response = 'accepted'
         where proposal_id = $1`,
        [target.proposal_id],
      ),
    );
    check(
      "a response cannot be written directly, only through the function",
      denied !== null && /permission denied|row-level security/.test(denied.message),
      denied?.message ?? "the update was accepted",
    );
  });

  await asUser(db, bob, async () => {
    const denied = await errorFrom(
      db.query(`update public.trip_proposals set status = 'cancelled' where id = $1`, [
        target.proposal_id,
      ]),
    );
    check(
      "nor can a proposal be resolved directly",
      denied !== null && /permission denied|row-level security/.test(denied.message),
      denied?.message ?? "the update was accepted",
    );
  });

  await asUser(db, alice, async () => {
    const denied = await errorFrom(
      db.query(`delete from public.trip_proposals where id = $1`, [target.proposal_id]),
    );
    check(
      "a proposal cannot be deleted to hide it",
      denied !== null && /permission denied|row-level security/.test(denied.message),
      denied?.message ?? "the delete was accepted",
    );
  });

  await asUser(db, alice, async () => {
    const denied = await errorFrom(
      db.query(
        `insert into public.trip_proposal_participants (proposal_id, user_id, response, responded_at)
         values ($1, $2, 'accepted', now())`,
        [target.proposal_id, carol.id],
      ),
    );
    check(
      "a proposer cannot add somebody already marked as having agreed",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  await asUser(db, bob, async () => {
    const denied = await errorFrom(
      db.query(
        `insert into public.trip_proposal_participants (proposal_id, user_id) values ($1, $2)`,
        [target.proposal_id, carol.id],
      ),
    );
    check(
      "somebody else cannot add people to your proposal",
      denied !== null,
      denied?.message ?? "the insert was accepted",
    );
  });

  await asUser(db, outsider, async () => {
    const { rows } = await db.query(`select id from public.trip_proposals`);
    check("a non-member sees no proposals at all", rows.length === 0, `saw ${rows.length}`);
  });

  // A header with nobody on it would sit pending forever, blocking the car's
  // fills and answerable by no one.
  const empty = await errorFrom(
    db.exec(`
      begin;
      insert into public.trip_proposals (car_id, proposed_by, start_km, end_km, driven_on)
      values ('${direct}', '${alice}', 700, 800, current_date);
      commit;
    `),
  );
  check(
    "a proposal with nobody on it is rejected at commit",
    empty !== null && /nobody to ask/.test(empty.message),
    empty?.message ?? "the insert was accepted",
  );
  await db.exec("rollback").catch(() => {});

  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}
