-- A proposal is a question, and a question that has been answered is not worth
-- keeping.
--
-- `trip_proposals` now holds pending rows only: accepting, rejecting and
-- withdrawing all delete it. That removes the whole resolution apparatus —
-- status, trip_id, resolved_by, resolved_at — and with it the possibility of the
-- table growing forever with rows nothing ever reads.
--
-- Two things had to move first.
--
-- `trips.proposal_id` was what froze a confirmed trip, and it pointed at the
-- proposal with `on delete set null`. Deleting the proposal would have quietly
-- unfrozen the trip — the exact hole the freeze exists to close. The fact worth
-- keeping is not *which* proposal it came from but *that* everyone agreed, so
-- that is what the trip now carries: `trips.confirmed`.
--
-- The emails are sent after the resolution and used to read the proposal back
-- out of the database. There is nothing left to read, so the functions return
-- what the message needs instead.
--
-- What is lost: there is no longer a record of who rejected what, or of the
-- agreement behind a trip beyond the boolean. The emails are the only trace. On
-- a shared car between three people that is the right trade; on anything that
-- had to be auditable it would not be.

-- ---------------------------------------------------------------------------
-- Policies come down first: a column cannot be dropped while one refers to it.
-- ---------------------------------------------------------------------------

drop policy "you can edit your own unsettled trips" on public.trips;
drop policy "members can record their own trips" on public.trips;
drop policy "you or an owner can delete an unsettled trip" on public.trips;
drop policy "you can put yourself on your own unsettled trip" on public.trip_shares;
drop policy "the recorder can change the participants of an unsettled trip" on public.trip_shares;
drop policy "members can propose a trip" on public.trip_proposals;
drop policy "the proposer names the people on the drive" on public.trip_proposal_participants;

-- ---------------------------------------------------------------------------
-- The trip remembers that it was agreed, rather than what agreed it.
-- ---------------------------------------------------------------------------

alter table public.trips add column confirmed boolean not null default false;

update public.trips set confirmed = true where proposal_id is not null;

alter table public.trips drop column proposal_id;

comment on column public.trips.confirmed is
  'Everyone on this trip confirmed it. Such trips cannot be edited, only deleted.';

-- ---------------------------------------------------------------------------
-- Only pending proposals exist now.
-- ---------------------------------------------------------------------------

delete from public.trip_proposals where status <> 'pending';

drop index public.trip_proposals_car_pending_idx;
drop index public.trip_proposals_no_duplicates;

alter table public.trip_proposals
  drop constraint trip_proposals_resolved_together,
  drop constraint trip_proposals_trip_only_when_accepted,
  drop column status,
  drop column trip_id,
  drop column resolved_by,
  drop column resolved_at;

create index trip_proposals_car_id_idx on public.trip_proposals (car_id);

-- A double-tapped button still must not raise the same request twice. It is no
-- longer partial, because there is nothing else in the table — and a proposal
-- that was rejected can now be raised again, which the partial index allowed
-- but is worth saying out loud.
create unique index trip_proposals_no_duplicates
  on public.trip_proposals (car_id, start_km, end_km, driven_on);

-- ---------------------------------------------------------------------------
-- Policies again, on `confirmed` rather than `proposal_id`.
-- ---------------------------------------------------------------------------

create policy "you can edit your own unsettled trips"
  on public.trips for update to authenticated
  using (
    recorded_by = (select auth.uid())
    and fill_id is null
    and not confirmed
    and public.is_car_member(car_id)
  )
  with check (
    recorded_by = (select auth.uid())
    and fill_id is null
    and not confirmed
    and public.is_car_member(car_id)
  );

-- `confirmed` is a claim that other people agreed, so only the function that
-- collects their agreement may make it.
create policy "members can record their own trips"
  on public.trips for insert to authenticated
  with check (
    public.is_car_member(car_id)
    and recorded_by = (select auth.uid())
    and fill_id is null
    and not confirmed
  );

-- Widened: anyone the trip charges can delete it, not only whoever wrote it
-- down. Confirming a trip somebody else recorded used to leave you carrying
-- kilometres you had no way to take back — you had to ask them. Deleting only
-- ever removes distance from the people on it; it cannot move distance onto
-- somebody who never agreed, which is why this is safe to widen and editing is
-- not.
create policy "anyone on an unsettled trip can delete it"
  on public.trips for delete to authenticated
  using (
    fill_id is null
    and (
      recorded_by = (select auth.uid())
      or public.is_car_owner(car_id)
      or exists (
        select 1 from public.trip_shares s
        where s.trip_id = trips.id and s.user_id = (select auth.uid())
      )
    )
  );

create policy "you can put yourself on your own unsettled trip"
  on public.trip_shares for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.fill_id is null
        and not t.confirmed
        and t.recorded_by = (select auth.uid())
    )
  );

create policy "the recorder can change the participants of an unsettled trip"
  on public.trip_shares for delete to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.fill_id is null
        and not t.confirmed
        and t.recorded_by = (select auth.uid())
    )
  );

create policy "members can propose a trip"
  on public.trip_proposals for insert to authenticated
  with check (
    public.is_car_member(car_id)
    and proposed_by = (select auth.uid())
  );

create policy "the proposer names the people on the drive"
  on public.trip_proposal_participants for insert to authenticated
  with check (
    exists (
      select 1 from public.trip_proposals p
      where p.id = proposal_id and p.proposed_by = (select auth.uid())
    )
    -- Only people actually in the car can be asked to pay for a drive.
    and exists (
      select 1 from public.trip_proposals p
      join public.memberships m on m.car_id = p.car_id
      where p.id = proposal_id
        and m.user_id = trip_proposal_participants.user_id
    )
    -- You may answer for yourself and nobody else. This is what stops a
    -- proposer inserting everyone else already marked as having agreed.
    and (user_id = (select auth.uid()) or response = 'pending')
  );

-- ---------------------------------------------------------------------------
-- "Is anything outstanding for this car?"
--
-- Behind a function so that settle_fill never has to be re-declared for a
-- change of shape again. Its body is repeated in three migrations already, and
-- every copy of a function that turns kilometres into money is a chance for one
-- of them to drift.
-- ---------------------------------------------------------------------------

create or replace function public.car_has_pending_proposal(p_car_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.trip_proposals p where p.car_id = p_car_id
  );
$fn$;

create or replace function public.has_pending_proposal(p_car_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.trip_proposals p
    where p.car_id = p_car_id
      and (
        p.proposed_by = p_user_id
        or exists (
          select 1 from public.trip_proposal_participants pp
          where pp.proposal_id = p.id and pp.user_id = p_user_id
        )
      )
  );
$fn$;

revoke execute on function public.car_has_pending_proposal(uuid) from public;
grant execute on function public.car_has_pending_proposal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Everything a message about this proposal needs, gathered before the row goes.
-- ---------------------------------------------------------------------------

create or replace function public.trip_proposal_payload(p_proposal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'car_id',      p.car_id,
    'car_name',    c.name,
    'proposed_by', p.proposed_by,
    'start_km',    p.start_km,
    'end_km',      p.end_km,
    'distance_km', p.distance_km,
    'driven_on',   p.driven_on,
    'note',        p.note,
    'people',      (
      select coalesce(jsonb_agg(pp.user_id order by pp.user_id), '[]'::jsonb)
      from public.trip_proposal_participants pp
      where pp.proposal_id = p.id
    )
  )
  from public.trip_proposals p
  join public.cars c on c.id = p.car_id
  where p.id = p_proposal_id;
$fn$;

-- ---------------------------------------------------------------------------
-- Answering one.
--
-- The row is locked on the way in. Without that, two people accepting a
-- three-way at the same moment each count the other as still pending — neither
-- creates the trip, and the proposal is stuck forever, blocking the car's
-- fills. `for update` is safe here in a way it would not be in an invoker-rights
-- function: RLS is off inside a definer function owned by the schema owner, so
-- a locking read cannot silently hide a row the way an UPDATE policy would.
-- ---------------------------------------------------------------------------

create or replace function public.respond_to_trip_proposal(
  p_proposal_id uuid,
  p_accept      boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user      uuid := (select auth.uid());
  v_proposal  public.trip_proposals%rowtype;
  v_answered  integer;
  v_remaining integer;
  v_trip_id   uuid;
  v_payload   jsonb;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  select * into v_proposal
  from public.trip_proposals p
  where p.id = p_proposal_id
  for update;

  -- Answered, withdrawn, or never there. They are the same thing now, and the
  -- screen says the same thing for all three: it is no longer waiting on you.
  if not found then
    return jsonb_build_object('status', 'already_resolved');
  end if;

  update public.trip_proposal_participants
  set response     = case when p_accept then 'accepted' else 'rejected' end,
      responded_at = now()
  where proposal_id = p_proposal_id
    and user_id = v_user
    and response = 'pending';

  get diagnostics v_answered = row_count;
  if v_answered = 0 then
    if not exists (
      select 1 from public.trip_proposal_participants pp
      where pp.proposal_id = p_proposal_id and pp.user_id = v_user
    ) then
      return jsonb_build_object('status', 'not_a_participant');
    end if;
    return jsonb_build_object('status', 'already_responded');
  end if;

  -- Gathered while the row still exists.
  v_payload := public.trip_proposal_payload(p_proposal_id);

  if not p_accept then
    delete from public.trip_proposals where id = p_proposal_id;
    return jsonb_build_object(
      'status', 'ok', 'outcome', 'rejected', 'proposal', v_payload
    );
  end if;

  select count(*)::integer into v_remaining
  from public.trip_proposal_participants pp
  where pp.proposal_id = p_proposal_id and pp.response = 'pending';

  if v_remaining > 0 then
    return jsonb_build_object('status', 'ok', 'outcome', 'awaiting', 'remaining', v_remaining);
  end if;

  -- Everyone has agreed. Now, and only now, does this become a fact.
  v_trip_id := gen_random_uuid();

  insert into public.trips
    (id, car_id, recorded_by, start_km, end_km, driven_on, note, confirmed)
  values
    (v_trip_id, v_proposal.car_id, v_proposal.proposed_by, v_proposal.start_km,
     v_proposal.end_km, v_proposal.driven_on, v_proposal.note, true);

  insert into public.trip_shares (trip_id, user_id)
  select v_trip_id, pp.user_id
  from public.trip_proposal_participants pp
  where pp.proposal_id = p_proposal_id;

  -- The participants go with it, by cascade. The trip is the record now.
  delete from public.trip_proposals where id = p_proposal_id;

  return jsonb_build_object(
    'status', 'ok',
    'outcome', 'accepted',
    'trip_id', v_trip_id,
    'proposal', v_payload
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Withdrawing one. The proposer, or an owner.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_trip_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user     uuid := (select auth.uid());
  v_proposal public.trip_proposals%rowtype;
  v_payload  jsonb;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  select * into v_proposal
  from public.trip_proposals p
  where p.id = p_proposal_id
  for update;

  if not found then
    return jsonb_build_object('status', 'already_resolved');
  end if;

  -- Definer rights mean the read above saw everything. Answer a stranger the
  -- way RLS would have: as though it does not exist.
  if not public.is_car_member(v_proposal.car_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_proposal.proposed_by <> v_user and not public.is_car_owner(v_proposal.car_id) then
    return jsonb_build_object('status', 'not_yours');
  end if;

  v_payload := public.trip_proposal_payload(p_proposal_id);

  delete from public.trip_proposals where id = p_proposal_id;

  return jsonb_build_object('status', 'ok', 'outcome', 'cancelled', 'proposal', v_payload);
end;
$fn$;

revoke execute on function public.trip_proposal_payload(uuid) from public;
grant execute on function public.trip_proposal_payload(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_trip, reading the new marker.
-- ---------------------------------------------------------------------------

create or replace function public.update_trip(
  p_trip_id      uuid,
  p_start_km     integer,
  p_end_km       integer,
  p_driven_on    date,
  p_participants uuid[] default null,
  p_note         text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  v_user   uuid := (select auth.uid());
  v_trip   public.trips%rowtype;
  v_people uuid[];
  v_person uuid;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  -- Deliberately not `for update`. A locking select applies the UPDATE policy
  -- as well as the SELECT one, so a trip belonging to someone else, or an
  -- already settled trip, would vanish here and every case would collapse into
  -- 'not_found'. Reading it plainly lets each case get its own answer; the
  -- UPDATE below is still governed by the policy, and the row count is checked.
  select * into v_trip from public.trips t where t.id = p_trip_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_trip.fill_id is not null then
    return jsonb_build_object('status', 'settled');
  end if;

  if v_trip.confirmed then
    return jsonb_build_object('status', 'from_proposal');
  end if;

  if v_trip.recorded_by <> v_user then
    return jsonb_build_object('status', 'not_yours');
  end if;

  if p_end_km <= p_start_km or p_start_km < 0 then
    return jsonb_build_object('status', 'bad_distance');
  end if;

  if p_driven_on > (current_date + 1) then
    return jsonb_build_object('status', 'future_date');
  end if;

  v_people := array(
    select distinct unnest
    from unnest(coalesce(p_participants, array[]::uuid[]) || v_trip.recorded_by)
  );

  foreach v_person in array v_people loop
    if v_person <> v_user and not exists (
      -- Already on this trip. Nobody new can be added by an edit; that is what
      -- propose_trip is for.
      select 1 from public.trip_shares s
      where s.trip_id = p_trip_id and s.user_id = v_person
    ) then
      return jsonb_build_object('status', 'needs_confirmation');
    end if;
  end loop;

  update public.trips
  set start_km  = p_start_km,
      end_km    = p_end_km,
      driven_on = p_driven_on,
      note      = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_trip_id;

  -- RLS is the real gate. If the checks above ever disagree with the policy,
  -- the policy wins and nothing was written, so say so rather than reporting
  -- a success that did not happen.
  if not found then
    return jsonb_build_object('status', 'not_allowed');
  end if;

  -- Only the difference is written, rather than clearing and re-adding every
  -- row. The insert policy on trip_shares requires current membership, so
  -- re-inserting a departed member's share would be refused even though they
  -- are allowed to stay on the trip. Leaving their row untouched sidesteps
  -- that, and touches less of the table besides.
  delete from public.trip_shares
  where trip_id = p_trip_id
    and user_id <> all (v_people);

  insert into public.trip_shares (trip_id, user_id)
  select p_trip_id, person
  from unnest(v_people) as person
  where not exists (
    select 1 from public.trip_shares existing
    where existing.trip_id = p_trip_id and existing.user_id = person
  );

  return jsonb_build_object('status', 'ok', 'trip_id', p_trip_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- settle_fill, with the guard behind a function.
--
-- Everything below the guard is unchanged from 20260830200000_settlement.sql.
-- It is repeated only because Postgres has no way to amend a function body in
-- place. If this ever differs from that file by anything but the guard, one of
-- the two is wrong.
-- ---------------------------------------------------------------------------

create or replace function public.settle_fill(
  p_car_id      uuid,
  p_total_cents integer,
  p_filled_on   date,
  p_paid_by     uuid default null,
  p_odometer_km integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_payer   uuid;
  v_fill_id uuid := gen_random_uuid();
  v_scale    bigint := 1;
  v_count    integer;
  v_total_w  bigint;
  v_leftover integer;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  if not public.is_car_member(p_car_id) then
    return jsonb_build_object('status', 'not_member');
  end if;

  -- A pending proposal is kilometres that may still land in this period, and a
  -- settled fill cannot be reopened to take them into account.
  if public.car_has_pending_proposal(p_car_id) then
    return jsonb_build_object('status', 'pending_proposals');
  end if;

  if p_total_cents is null or p_total_cents <= 0 then
    return jsonb_build_object('status', 'bad_amount');
  end if;

  if p_filled_on is null or p_filled_on > (current_date + 1) then
    return jsonb_build_object('status', 'future_date');
  end if;

  -- Whoever is owed the money. Defaults to the person recording the fill.
  v_payer := coalesce(p_paid_by, v_user);
  if not exists (
    select 1 from public.memberships m
    where m.car_id = p_car_id and m.user_id = v_payer
  ) then
    return jsonb_build_object('status', 'payer_not_member');
  end if;

  -- Lock the period. Two people pressing "record fill" at the same moment must
  -- not both close it: the second waits here, then finds nothing open.
  perform 1
  from public.trips t
  where t.car_id = p_car_id and t.fill_id is null
  for update;

  if not exists (
    select 1 from public.trips t
    where t.car_id = p_car_id and t.fill_id is null
  ) then
    return jsonb_build_object('status', 'no_trips');
  end if;

  -- The scale that makes every share a whole number.
  for v_count in
    select count(*)::int
    from public.trips t
    join public.trip_shares s on s.trip_id = t.id
    where t.car_id = p_car_id and t.fill_id is null
    group by t.id
  loop
    v_scale := public.lcm_bigint(v_scale, v_count::bigint);
  end loop;

  insert into public.fills (id, car_id, paid_by, total_cents, odometer_km, filled_on)
  values (v_fill_id, p_car_id, v_payer, p_total_cents, p_odometer_km, p_filled_on);

  -- Weights first, amounts after. Doing it in named steps rather than one
  -- clever statement means each number can be checked on its own, which is
  -- worth more here than brevity: an error would be someone's money.
  insert into public.fill_shares (fill_id, user_id, km_scaled, km_scale, amount_cents)
  select v_fill_id, s.user_id,
         sum(t.distance_km::bigint * v_scale / participants.n),
         v_scale::integer,
         0
  from public.trips t
  join public.trip_shares s on s.trip_id = t.id
  join lateral (
    select count(*)::bigint as n
    from public.trip_shares x where x.trip_id = t.id
  ) participants on true
  where t.car_id = p_car_id and t.fill_id is null
  group by s.user_id;

  select coalesce(sum(km_scaled), 0) into v_total_w
  from public.fill_shares where fill_id = v_fill_id;

  if v_total_w <= 0 then
    -- Trips exist but nobody covered any distance. "Proportional" means nothing
    -- here, and guessing would put a real bill on an arbitrary person.
    raise exception 'settle_fill: no distance to split'
      using errcode = 'check_violation';
  end if;

  -- Everyone's whole cents.
  update public.fill_shares
  set amount_cents = (p_total_cents::bigint * km_scaled / v_total_w)::integer
  where fill_id = v_fill_id;

  -- What rounding down left on the table.
  select p_total_cents - coalesce(sum(amount_cents), 0) into v_leftover
  from public.fill_shares where fill_id = v_fill_id;

  -- Hand it out a cent at a time, to whoever was cut back hardest. The
  -- tie-break on user_id keeps it deterministic, so the same data always
  -- produces the same split.
  if v_leftover > 0 then
    update public.fill_shares
    set amount_cents = amount_cents + 1
    where fill_id = v_fill_id
      and user_id in (
        select user_id
        from public.fill_shares
        where fill_id = v_fill_id
        order by (p_total_cents::bigint * km_scaled) % v_total_w desc,
                 km_scaled desc,
                 user_id
        limit v_leftover
      );
  end if;

  -- Closing the period. The trips are kept, not deleted: they are the evidence
  -- behind a split that is about to be emailed to people.
  update public.trips
  set fill_id = v_fill_id
  where car_id = p_car_id and fill_id is null;

  return jsonb_build_object(
    'status', 'ok',
    'fill_id', v_fill_id,
    'km_scale', v_scale,
    'paid_by', v_payer,
    'shares', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'user_id', user_id,
          'km_scaled', km_scaled,
          'amount_cents', amount_cents
        ) order by amount_cents desc, user_id),
        '[]'::jsonb)
      from public.fill_shares where fill_id = v_fill_id
    )
  );
end;
$fn$;
