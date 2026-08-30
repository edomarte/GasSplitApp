-- Recording trips.
--
-- A trip and its participants have to be written in one transaction. The
-- `trips_require_shares` constraint trigger is deferred to commit, so inserting
-- the trip on its own — which is what two separate PostgREST calls would do —
-- fails at the end of the first request, before the shares can be added.
--
-- These functions run with INVOKER rights, unlike the invite ones. Nothing here
-- needs to see past RLS: the caller is already a member, and the policies on
-- `trips` and `trip_shares` are exactly the rules we want. The explicit checks
-- below exist to return usable messages, not to grant anything — RLS is still
-- the boundary, and stays the boundary if a check is ever wrong.

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
  v_people  uuid[];
  v_person  uuid;
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  if not public.is_car_member(p_car_id) then
    return jsonb_build_object('status', 'not_member');
  end if;

  if p_end_km <= p_start_km then
    return jsonb_build_object('status', 'bad_distance');
  end if;

  if p_start_km < 0 then
    return jsonb_build_object('status', 'bad_distance');
  end if;

  -- A day of slack: the recorder's calendar can legitimately be ahead of the
  -- server's. Anything further out is a typo.
  if p_driven_on > (current_date + 1) then
    return jsonb_build_object('status', 'future_date');
  end if;

  -- The person recording the trip always drove it. A solo trip is the same
  -- shape as a split one, with a single participant.
  v_people := array(
    select distinct unnest
    from unnest(coalesce(p_participants, array[]::uuid[]) || v_user)
  );

  -- Splitting with someone outside the car would silently bill a stranger.
  foreach v_person in array v_people loop
    if not exists (
      select 1 from public.memberships m
      where m.car_id = p_car_id and m.user_id = v_person
    ) then
      return jsonb_build_object('status', 'not_all_members');
    end if;
  end loop;

  insert into public.trips (id, car_id, recorded_by, start_km, end_km, driven_on, note)
  values (v_trip_id, p_car_id, v_user, p_start_km, p_end_km, p_driven_on,
          nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.trip_shares (trip_id, user_id)
  select v_trip_id, unnest from unnest(v_people);

  return jsonb_build_object('status', 'ok', 'trip_id', v_trip_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Editing an unsettled trip. Participants are replaced wholesale, which is why
-- this cannot be a plain UPDATE: dropping the old shares and adding the new
-- ones has to happen together, or the trip briefly has no participants and
-- disappears from every aggregation.
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
    if not exists (
      select 1 from public.memberships m
      where m.car_id = v_trip.car_id and m.user_id = v_person
    ) then
      return jsonb_build_object('status', 'not_all_members');
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

  delete from public.trip_shares where trip_id = p_trip_id;
  insert into public.trip_shares (trip_id, user_id)
  select p_trip_id, unnest from unnest(v_people);

  return jsonb_build_object('status', 'ok', 'trip_id', p_trip_id);
end;
$fn$;

revoke execute on function public.add_trip(uuid, integer, integer, date, uuid[], text) from public;
revoke execute on function public.update_trip(uuid, integer, integer, date, uuid[], text) from public;
grant execute on function public.add_trip(uuid, integer, integer, date, uuid[], text) to authenticated;
grant execute on function public.update_trip(uuid, integer, integer, date, uuid[], text) to authenticated;

comment on function public.add_trip(uuid, integer, integer, date, uuid[], text) is
  'Inserts a trip and its participants together; two PostgREST calls cannot.';
