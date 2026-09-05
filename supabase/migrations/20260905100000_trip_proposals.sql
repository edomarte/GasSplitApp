-- Asking someone to confirm a trip.
--
-- Until now anyone could tick a co-member into a split drive and charge them
-- for it, and nobody could record a drive somebody else took. Both are the same
-- missing idea: a trip that bills a person who did not write it down needs that
-- person's agreement first.
--
-- A proposal is deliberately NOT a trip with a status column. `trips` is read by
-- `open_period_km`, `car_odometer`, `listOpenTrips` and `settle_fill`, and a
-- status flag would have to be remembered in every one of them — forget one and
-- the app silently bills someone for a drive they never agreed to. Keeping
-- proposals in their own tables means `trips` still means "an agreed fact", and
-- not one line of the settlement arithmetic changes.
--
-- The shape mirrors `invites`: created under an RLS policy, resolved by a
-- function, because resolving writes a row on behalf of somebody else.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.trip_proposals (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references public.cars (id) on delete cascade,
  proposed_by uuid not null references public.profiles (id),
  start_km    integer not null check (start_km >= 0),
  end_km      integer not null,
  distance_km integer generated always as (end_km - start_km) stored,
  driven_on   date not null,
  note        text check (note is null or length(note) <= 200),
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  -- The trip this became, once everyone agreed.
  trip_id     uuid,
  -- Whoever ended it: the last acceptor, the rejector, or the canceller.
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint trip_proposals_distance_positive check (end_km > start_km),
  constraint trip_proposals_resolved_together check (
    (status = 'pending') = (resolved_at is null)
  ),
  -- One direction only. "Accepted implies a trip" cannot hold: deleting a trip
  -- nulls this column, and an accepted proposal whose trip was later deleted is
  -- an honest state — it WAS accepted. What must never happen is the reverse, a
  -- proposal pointing at a trip it did not produce.
  constraint trip_proposals_trip_only_when_accepted check (
    trip_id is null or status = 'accepted'
  )
);

comment on table public.trip_proposals is
  'A trip somebody is asking others to confirm. Not a trip until they all do.';

-- The dashboard asks "is anything pending for this car" on every view, and so
-- does every fill and every attempt to leave.
create index trip_proposals_car_pending_idx
  on public.trip_proposals (car_id) where status = 'pending';

-- A double-tapped button must not raise the same request twice.
create unique index trip_proposals_no_duplicates
  on public.trip_proposals (car_id, start_km, end_km, driven_on)
  where status = 'pending';

-- One row per person on the drive, including the proposer when they were on it.
-- There is no driver_id on the proposal: the participants are the drive, and
-- whether the proposer is among them is what separates "you and I shared this"
-- from "you two drove without me".
create table public.trip_proposal_participants (
  proposal_id  uuid not null references public.trip_proposals (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  response     text not null default 'pending'
               check (response in ('pending', 'accepted', 'rejected')),
  responded_at timestamptz,
  primary key (proposal_id, user_id),
  constraint trip_proposal_participants_responded_together check (
    (response = 'pending') = (responded_at is null)
  )
);

create index trip_proposal_participants_user_idx
  on public.trip_proposal_participants (user_id);

-- A trip that came from a proposal. Nullable, and read by nothing that
-- aggregates, so every existing query keeps its meaning.
alter table public.trips
  add column proposal_id uuid references public.trip_proposals (id) on delete set null;

comment on column public.trips.proposal_id is
  'Set when the trip was agreed through a proposal. Such trips cannot be edited.';

-- Declared after `trips` gained the column, so the two tables can point at each
-- other without one of them having to exist first.
alter table public.trip_proposals
  add constraint trip_proposals_trip_id_fkey
  foreign key (trip_id) references public.trips (id) on delete set null;

-- A proposal nobody has to answer is just a trip, and a proposal with no
-- participants at all would sit pending forever, blocking the car's fills.
-- Deferred, so the function can write the header and the people together.
create or replace function public.assert_proposal_has_someone_to_ask()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.trip_proposal_participants p
    where p.proposal_id = new.id and p.user_id <> new.proposed_by
  ) then
    raise exception 'trip proposal % has nobody to ask', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$fn$;

create constraint trigger trip_proposals_require_someone_to_ask
  after insert on public.trip_proposals
  deferrable initially deferred
  for each row execute function public.assert_proposal_has_someone_to_ask();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Creating a proposal is expressible as a policy, so it is one. Answering and
-- cancelling are not — both write on behalf of somebody else — so neither table
-- is granted update or delete at all, and the functions below are the only way
-- a response can be recorded. Without that, a driver could PATCH their own row
-- to 'accepted' and never be given the kilometres.
-- ---------------------------------------------------------------------------

grant select, insert on public.trip_proposals             to authenticated;
grant select, insert on public.trip_proposal_participants to authenticated;

revoke all on public.trip_proposals             from anon;
revoke all on public.trip_proposal_participants from anon;

alter table public.trip_proposals             enable row level security;
alter table public.trip_proposal_participants enable row level security;

create policy "members can see the proposals of their car"
  on public.trip_proposals for select to authenticated
  using (public.is_car_member(car_id));

create policy "members can propose a trip"
  on public.trip_proposals for insert to authenticated
  with check (
    public.is_car_member(car_id)
    and proposed_by = (select auth.uid())
    and status = 'pending'
    and trip_id is null
    and resolved_at is null
  );

create policy "members can see who a proposal is waiting on"
  on public.trip_proposal_participants for select to authenticated
  using (
    exists (
      select 1 from public.trip_proposals p
      where p.id = proposal_id and public.is_car_member(p.car_id)
    )
  );

create policy "the proposer names the people on the drive"
  on public.trip_proposal_participants for insert to authenticated
  with check (
    exists (
      select 1 from public.trip_proposals p
      where p.id = proposal_id
        and p.status = 'pending'
        and p.proposed_by = (select auth.uid())
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
-- Raising one.
--
-- Invoker rights, like add_trip. This needs to be a function only because the
-- proposal and its participants must be written in one transaction — the
-- deferred trigger above rejects a header on its own — not because it needs to
-- see anything RLS would hide.
--
-- Unlike add_trip, the caller is NOT added to the drive automatically: a
-- proposal for a trip they were not on is the whole point.
-- ---------------------------------------------------------------------------

create or replace function public.propose_trip(
  p_car_id       uuid,
  p_start_km     integer,
  p_end_km       integer,
  p_driven_on    date,
  p_participants uuid[],
  p_note         text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $fn$
declare
  v_user        uuid := (select auth.uid());
  v_proposal_id uuid := gen_random_uuid();
  v_people      uuid[];
  v_person      uuid;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  if not public.is_car_member(p_car_id) then
    return jsonb_build_object('status', 'not_member');
  end if;

  if p_end_km <= p_start_km or p_start_km < 0 then
    return jsonb_build_object('status', 'bad_distance');
  end if;

  if p_driven_on > (current_date + 1) then
    return jsonb_build_object('status', 'future_date');
  end if;

  v_people := array(
    select distinct unnest from unnest(coalesce(p_participants, array[]::uuid[]))
  );

  foreach v_person in array v_people loop
    if not exists (
      select 1 from public.memberships m
      where m.car_id = p_car_id and m.user_id = v_person
    ) then
      return jsonb_build_object('status', 'not_all_members');
    end if;
  end loop;

  -- Nobody to ask means this is an ordinary trip, and add_trip is the way to
  -- record one. Saying so is better than raising a proposal that resolves the
  -- instant it is created.
  if not exists (select 1 from unnest(v_people) as person where person <> v_user) then
    return jsonb_build_object('status', 'no_one_to_ask');
  end if;

  insert into public.trip_proposals
    (id, car_id, proposed_by, start_km, end_km, driven_on, note)
  values
    (v_proposal_id, p_car_id, v_user, p_start_km, p_end_km, p_driven_on,
     nullif(btrim(coalesce(p_note, '')), ''));

  -- The proposer's own agreement is implied by their asking. Asking yourself
  -- would be theatre, and it would leave a proposal that can never resolve if
  -- they simply never look at it again.
  insert into public.trip_proposal_participants (proposal_id, user_id, response, responded_at)
  select
    v_proposal_id,
    person,
    case when person = v_user then 'accepted' else 'pending' end,
    case when person = v_user then now() else null end
  from unnest(v_people) as person;

  return jsonb_build_object(
    'status', 'ok',
    'proposal_id', v_proposal_id,
    'asked', (select count(*) from unnest(v_people) as person where person <> v_user)
  );
exception
  when unique_violation then
    -- The partial unique index on (car, readings, date) while pending. Almost
    -- always a double-tapped button rather than a second real drive.
    return jsonb_build_object('status', 'duplicate');
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Answering one.
--
-- SECURITY DEFINER, and it has to be: accepting writes a `trips` row whose
-- recorded_by is the proposer, not the caller, which the insert policy on
-- `trips` forbids outright. RLS is bypassed inside, so every check is explicit.
--
-- Everyone must accept before anything is recorded, and one rejection kills the
-- whole proposal. Dropping the rejector and splitting between the rest would
-- quietly charge the remaining people MORE than they agreed to — a 160 km
-- three-way at 53 km each becoming 80 km each because somebody else said no.
-- Asking again is the honest repair.
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
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  select * into v_proposal from public.trip_proposals p where p.id = p_proposal_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not exists (
    select 1 from public.trip_proposal_participants pp
    where pp.proposal_id = p_proposal_id and pp.user_id = v_user
  ) then
    return jsonb_build_object('status', 'not_a_participant');
  end if;

  if v_proposal.status <> 'pending' then
    return jsonb_build_object('status', 'already_resolved', 'outcome', v_proposal.status);
  end if;

  -- The response and the resolution are both conditional on still being
  -- pending, so two people answering at the same moment cannot both win: the
  -- second update matches no rows and says so. No `for update` anywhere — a
  -- locking read applies the UPDATE policy as well as the SELECT one, which
  -- collapses every distinct case into "not found".
  update public.trip_proposal_participants
  set response     = case when p_accept then 'accepted' else 'rejected' end,
      responded_at = now()
  where proposal_id = p_proposal_id
    and user_id = v_user
    and response = 'pending';

  get diagnostics v_answered = row_count;
  if v_answered = 0 then
    return jsonb_build_object('status', 'already_responded');
  end if;

  if not p_accept then
    update public.trip_proposals
    set status = 'rejected', resolved_by = v_user, resolved_at = now()
    where id = p_proposal_id and status = 'pending';

    get diagnostics v_answered = row_count;
    if v_answered = 0 then
      return jsonb_build_object('status', 'already_resolved');
    end if;

    return jsonb_build_object('status', 'ok', 'outcome', 'rejected');
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
    (id, car_id, recorded_by, start_km, end_km, driven_on, note, proposal_id)
  values
    (v_trip_id, v_proposal.car_id, v_proposal.proposed_by, v_proposal.start_km,
     v_proposal.end_km, v_proposal.driven_on, v_proposal.note, p_proposal_id);

  insert into public.trip_shares (trip_id, user_id)
  select v_trip_id, pp.user_id
  from public.trip_proposal_participants pp
  where pp.proposal_id = p_proposal_id;

  update public.trip_proposals
  set status = 'accepted', trip_id = v_trip_id, resolved_by = v_user, resolved_at = now()
  where id = p_proposal_id and status = 'pending';

  get diagnostics v_answered = row_count;
  if v_answered = 0 then
    -- Somebody resolved it between the count above and here. Abort rather than
    -- leave a trip that no proposal points at.
    raise exception 'trip proposal % was resolved concurrently', p_proposal_id
      using errcode = 'serialization_failure';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'outcome', 'accepted',
    'trip_id', v_trip_id,
    'proposal_id', p_proposal_id
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Withdrawing one.
--
-- The proposer, or an owner. The owner's power matters more than it looks: a
-- pending proposal blocks the car's fills, so without it one member who never
-- opens the app could hold the group's money hostage indefinitely. It mirrors
-- the existing rule that an owner can delete any unsettled trip.
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
  v_count    integer;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  select * into v_proposal from public.trip_proposals p where p.id = p_proposal_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Definer rights mean the read above saw everything. Answer a stranger the
  -- way RLS would have: as though it does not exist.
  if not public.is_car_member(v_proposal.car_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_proposal.proposed_by <> v_user and not public.is_car_owner(v_proposal.car_id) then
    return jsonb_build_object('status', 'not_yours');
  end if;

  if v_proposal.status <> 'pending' then
    return jsonb_build_object('status', 'already_resolved', 'outcome', v_proposal.status);
  end if;

  update public.trip_proposals
  set status = 'cancelled', resolved_by = v_user, resolved_at = now()
  where id = p_proposal_id and status = 'pending';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('status', 'already_resolved');
  end if;

  return jsonb_build_object('status', 'ok', 'outcome', 'cancelled');
end;
$fn$;

revoke execute on function public.propose_trip(uuid, integer, integer, date, uuid[], text) from public;
revoke execute on function public.respond_to_trip_proposal(uuid, boolean) from public;
revoke execute on function public.cancel_trip_proposal(uuid) from public;
grant execute on function public.propose_trip(uuid, integer, integer, date, uuid[], text) to authenticated;
grant execute on function public.respond_to_trip_proposal(uuid, boolean) to authenticated;
grant execute on function public.cancel_trip_proposal(uuid) to authenticated;

comment on function public.respond_to_trip_proposal(uuid, boolean) is
  'The only way a proposal becomes a trip. Everyone accepts, or one rejection ends it.';

-- ---------------------------------------------------------------------------
-- A trip born of a proposal is frozen.
--
-- Otherwise the whole feature is theatre: propose "you drove 20 km", wait for
-- the confirmation, then edit it to 200. Deleting one is still allowed, because
-- deleting only ever removes kilometres from somebody — it cannot quietly move
-- them onto a person who never agreed. Changing your mind means delete and ask
-- again.
-- ---------------------------------------------------------------------------

drop policy "you can edit your own unsettled trips" on public.trips;

create policy "you can edit your own unsettled trips"
  on public.trips for update to authenticated
  using (
    recorded_by = (select auth.uid())
    and fill_id is null
    and proposal_id is null
    and public.is_car_member(car_id)
  )
  with check (
    recorded_by = (select auth.uid())
    and fill_id is null
    and proposal_id is null
    and public.is_car_member(car_id)
  );

-- Only respond_to_trip_proposal may stamp a trip with a proposal, so a client
-- cannot freeze a trip of its own by inventing one.
drop policy "members can record their own trips" on public.trips;


create policy "members can record their own trips"
  on public.trips for insert to authenticated
  with check (
    public.is_car_member(car_id)
    and recorded_by = (select auth.uid())
    and fill_id is null
    and proposal_id is null
  );

-- The hole this closes is the whole point of the feature. Narrowing add_trip
-- alone would have been theatre: the old policy let the recorder of a trip
-- insert a `trip_shares` row for anybody in the car, so one PostgREST call
-- could still bill a co-member who was never asked. You may now put only
-- yourself on a trip; everyone else arrives through the definer function, which
-- runs when they have agreed.
drop policy "the recorder sets the participants of an unsettled trip" on public.trip_shares;

create policy "you can put yourself on your own unsettled trip"
  on public.trip_shares for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.fill_id is null
        and t.proposal_id is null
        and t.recorded_by = (select auth.uid())
    )
  );

-- Removing yourself, or tidying a trip you recorded, stays possible; the shares
-- of a proposal-born trip do not, because the trip itself is frozen.
drop policy "the recorder can change the participants of an unsettled trip" on public.trip_shares;

create policy "the recorder can change the participants of an unsettled trip"
  on public.trip_shares for delete to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.fill_id is null
        and t.proposal_id is null
        and t.recorded_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Nobody may be added to a trip without agreeing to it.
--
-- add_trip becomes solo-only, and update_trip can no longer bring anyone new
-- onto a trip. Without this the consent flow would merely be the polite option,
-- and the old path — tick a co-member, charge them — would still be open.
--
-- Whoever is already on a trip stays: that includes a member who has since left
-- the car, whose kilometres are a fact somebody has to be charged for.
-- ---------------------------------------------------------------------------

create or replace function public.add_trip(
  p_car_id       uuid,
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
  v_user    uuid := (select auth.uid());
  v_trip_id uuid := gen_random_uuid();
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  if not public.is_car_member(p_car_id) then
    return jsonb_build_object('status', 'not_member');
  end if;

  if p_end_km <= p_start_km or p_start_km < 0 then
    return jsonb_build_object('status', 'bad_distance');
  end if;

  -- A day of slack: the recorder's calendar can legitimately be ahead of the
  -- server's. Anything further out is a typo.
  if p_driven_on > (current_date + 1) then
    return jsonb_build_object('status', 'future_date');
  end if;

  -- A shared drive is somebody else's money. It goes through propose_trip.
  if exists (
    select 1 from unnest(coalesce(p_participants, array[]::uuid[])) as person
    where person <> v_user
  ) then
    return jsonb_build_object('status', 'needs_confirmation');
  end if;

  insert into public.trips (id, car_id, recorded_by, start_km, end_km, driven_on, note)
  values (v_trip_id, p_car_id, v_user, p_start_km, p_end_km, p_driven_on,
          nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.trip_shares (trip_id, user_id) values (v_trip_id, v_user);

  return jsonb_build_object('status', 'ok', 'trip_id', v_trip_id);
end;
$fn$;

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

  if v_trip.proposal_id is not null then
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
-- Nothing settles, and nobody leaves, while a question is outstanding.
--
-- Both blocks exist for the same reason: a pending proposal is kilometres that
-- may or may not belong to somebody. Settling around it would bill the wrong
-- split and cannot be undone; letting the person walk out would leave a
-- question nobody can answer, and a car whose fills are blocked forever.
--
-- There is always a way out. Answer what is addressed to you, cancel what you
-- raised, or ask an owner to cancel it.
-- ---------------------------------------------------------------------------

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
      and p.status = 'pending'
      and (
        p.proposed_by = p_user_id
        or exists (
          select 1 from public.trip_proposal_participants pp
          where pp.proposal_id = p.id and pp.user_id = p_user_id
        )
      )
  );
$fn$;

revoke execute on function public.has_pending_proposal(uuid, uuid) from public;
grant execute on function public.has_pending_proposal(uuid, uuid) to authenticated;

drop policy "owners can remove members, and anyone can leave" on public.memberships;

create policy "owners can remove members, and anyone can leave"
  on public.memberships for delete to authenticated
  using (
    (user_id = (select auth.uid()) or public.is_car_owner(car_id))
    and not public.has_pending_proposal(car_id, user_id)
  );

-- ---------------------------------------------------------------------------
-- settle_fill, with one guard added at the top.
--
-- Everything below the guard is unchanged from 20260830200000_settlement.sql
-- and is repeated only because Postgres has no way to amend a function body in
-- place. The arithmetic is the part that must not drift: if this ever differs
-- from that file by anything other than the pending-proposal check, one of the
-- two is wrong.
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

  -- The guard. A pending proposal is kilometres that may still land in this
  -- period, and a settled fill cannot be reopened to take them into account.
  if exists (
    select 1 from public.trip_proposals p
    where p.car_id = p_car_id and p.status = 'pending'
  ) then
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
