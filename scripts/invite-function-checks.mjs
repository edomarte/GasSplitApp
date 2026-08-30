/**
 * The invite redemption path.
 *
 * This is the only way a membership row can ever be created, so it carries the
 * whole weight of "who is allowed into a car". Everything here runs as the
 * `authenticated` role, the way PostgREST would call it.
 */
export async function runInviteFunctionChecks(db, { alice, bob, outsider }, { check, asUser }) {
  console.log("\nInvite functions");

  const {
    rows: [car],
  } = await db.query(
    `insert into public.cars (name, created_by) values ('Invite Car', $1) returning id`,
    [alice],
  );

  const invite = async (hash, { expired = false, acceptedBy = null } = {}) => {
    const {
      rows: [row],
    } = await db.query(
      `insert into public.invites (car_id, token_hash, created_by, expires_at, accepted_by, accepted_at)
       values ($1, $2, $3, now() + ($4::text || ' hours')::interval, $5::uuid,
               case when $5::uuid is null then null else now() end)
       returning id`,
      [car.id, hash, alice, expired ? "-1" : "168", acceptedBy],
    );
    return row.id;
  };

  // --- preview -------------------------------------------------------------

  await invite("live-token");

  await asUser(db, outsider, async () => {
    const {
      rows: [{ invite_preview: preview }],
    } = await db.query(`select public.invite_preview($1)`, ["live-token"]);
    check(
      "an invited stranger sees the car name and who invited them",
      preview.status === "ok" && preview.car_name === "Invite Car" && preview.invited_by === "Alice Bianchi",
      JSON.stringify(preview),
    );
    check(
      "the preview does not claim they are already a member",
      preview.already_member === false,
      JSON.stringify(preview),
    );
  });

  await asUser(db, outsider, async () => {
    const {
      rows: [{ invite_preview: preview }],
    } = await db.query(`select public.invite_preview($1)`, ["no-such-token"]);
    check("an unknown token previews as not_found", preview.status === "not_found");
  });

  await asUser(db, outsider, async () => {
    const { rows } = await db.query(`select id, token_hash from public.invites`);
    check(
      "the invited stranger still cannot read the invites table itself",
      rows.length === 0,
      `saw ${rows.length}`,
    );
  });

  // --- redeeming -----------------------------------------------------------

  await asUser(db, outsider, async () => {
    const {
      rows: [{ redeem_invite: result }],
    } = await db.query(`select public.redeem_invite($1)`, ["live-token"]);
    check(
      "a valid invite lets a stranger join",
      result.status === "joined" && result.car_id === car.id,
      JSON.stringify(result),
    );

    const { rows: members } = await db.query(
      `select role from public.memberships where car_id = $1 and user_id = $2`,
      [car.id, outsider],
    );
    check(
      "the new member joins as a member, not an owner",
      members.length === 1 && members[0].role === "member",
      JSON.stringify(members),
    );

    const { rows: cars } = await db.query(`select id from public.cars where id = $1`, [car.id]);
    check("the new member can now see the car", cars.length === 1);
  });

  // asUser rolls back, so the join above is undone; redeem it for real now.
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [outsider]);
  await db.query(`select public.redeem_invite($1)`, ["live-token"]);

  await asUser(db, outsider, async () => {
    const {
      rows: [{ redeem_invite: result }],
    } = await db.query(`select public.redeem_invite($1)`, ["live-token"]);
    check(
      "clicking your own invite twice is not an error",
      result.status === "already_member" && result.car_id === car.id,
      JSON.stringify(result),
    );
  });

  await asUser(db, bob, async () => {
    const {
      rows: [{ redeem_invite: result }],
    } = await db.query(`select public.redeem_invite($1)`, ["live-token"]);
    check(
      "a spent invite cannot be reused by someone else",
      result.status === "used",
      JSON.stringify(result),
    );

    const { rows } = await db.query(
      `select user_id from public.memberships where car_id = $1 and user_id = $2`,
      [car.id, bob],
    );
    check("the second claimant gained no membership", rows.length === 0, `saw ${rows.length}`);
  });

  await invite("expired-token", { expired: true });

  await asUser(db, bob, async () => {
    const {
      rows: [{ redeem_invite: result }],
    } = await db.query(`select public.redeem_invite($1)`, ["expired-token"]);
    check("an expired invite is refused", result.status === "expired", JSON.stringify(result));
  });

  await asUser(db, bob, async () => {
    const {
      rows: [{ redeem_invite: result }],
    } = await db.query(`select public.redeem_invite($1)`, ["guessed-token"]);
    check("an unknown token is refused", result.status === "not_found", JSON.stringify(result));
  });

  // --- the guarantee the whole design rests on -----------------------------

  await asUser(db, bob, async () => {
    const { rows } = await db.query(
      `select id from public.cars where id = $1`,
      [car.id],
    );
    check(
      "someone who never redeemed anything still sees nothing",
      rows.length === 0,
      `saw ${rows.length}`,
    );
  });

  // Clean up the session identity used for the real redemption above.
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
}
