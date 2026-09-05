/**
 * Recording a trip the way the app now does it.
 *
 * A solo drive is still one call to add_trip. A shared one is no longer a call
 * at all: it is a proposal that every other person on it accepts, and only then
 * does a `trips` row exist. Every check suite that used to seed a split trip
 * with `add_trip(..., array[bob])` goes through here instead, so the seeding
 * exercises the same path a real group would.
 *
 * `participants` keeps add_trip's old meaning — the OTHER people on the drive,
 * not counting the recorder — so the call sites read the same as before.
 */

/** Runs `fn` as `userId` with the `authenticated` role, committing what it writes. */
export async function asMember(db, userId, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.exec(`set role authenticated`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

/**
 * Returns the result of the call that finished the job: add_trip's for a solo
 * drive, the last acceptance for a shared one. Both carry `trip_id` on success.
 */
export async function recordTrip(
  db,
  { carId, recordedBy, startKm, endKm, participants = null, drivenOn = null, note = null },
) {
  const others = (participants ?? []).filter((id) => id && id !== recordedBy);

  if (others.length === 0) {
    return asMember(db, recordedBy, async () => {
      const {
        rows: [row],
      } = await db.query(
        `select public.add_trip($1, $2, $3, coalesce($4::date, current_date), null, $5) as result`,
        [carId, startKm, endKm, drivenOn, note],
      );
      return row.result;
    });
  }

  const everyone = [...new Set([recordedBy, ...others])];

  const proposal = await asMember(db, recordedBy, async () => {
    const {
      rows: [row],
    } = await db.query(
      `select public.propose_trip($1, $2, $3, coalesce($4::date, current_date), $5::uuid[], $6)
       as result`,
      [carId, startKm, endKm, drivenOn, everyone, note],
    );
    return row.result;
  });

  if (proposal.status !== "ok") return proposal;

  let last = proposal;
  for (const person of others) {
    last = await asMember(db, person, async () => {
      const {
        rows: [row],
      } = await db.query(`select public.respond_to_trip_proposal($1, true) as result`, [
        proposal.proposal_id,
      ]);
      return row.result;
    });
    if (last.status !== "ok") return last;
  }

  return last;
}
