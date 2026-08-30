-- Former members keep the kilometres they drove.
--
-- `trip_shares.user_id` points at `profiles`, not `memberships`, so leaving a
-- car does not erase what you drove in it — nor should it. The distance is a
-- fact, and the settlement has to charge someone for it or the money will not
-- add up.
--
-- Two things were missing for that to work:
--
--   1. A departed member's name became unreadable. `shares_car_with` stops
--      matching the moment they leave, so the dashboard would list their
--      kilometres against nobody.
--   2. Editing a trip they took part in would fail, because `update_trip`
--      requires every participant to be a current member.

-- ---------------------------------------------------------------------------
-- Whoever has driven, or been billed for, a car you belong to.
-- ---------------------------------------------------------------------------

create or replace function public.appears_in_your_car(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.trip_shares s
    join public.trips t on t.id = s.trip_id
    where s.user_id = p_user_id
      and public.is_car_member(t.car_id)
  ) or exists (
    select 1
    from public.fill_shares fs
    join public.fills f on f.id = fs.fill_id
    where fs.user_id = p_user_id
      and public.is_car_member(f.car_id)
  );
$fn$;

revoke execute on function public.appears_in_your_car(uuid) from public;
grant execute on function public.appears_in_your_car(uuid) to authenticated;

-- Policies are OR'd, so this widens the existing one rather than replacing it.
-- Still narrow: it only ever exposes someone who shows up in the history of a
-- car the caller is actually in.
create policy "profiles of people who drove your car stay visible"
  on public.profiles for select to authenticated
  using (public.appears_in_your_car(id));

-- ---------------------------------------------------------------------------
-- Editing a trip that a departed member took part in.
--
-- They can stay on the trip they actually drove, but nobody new can be added
-- unless they are a current member. Without the first half, the trip becomes
-- uneditable forever; without the second, a stranger could be billed.
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
    ) and not exists (
      -- Already on this trip: a member who has since left keeps their share.
      select 1 from public.trip_shares s
      where s.trip_id = p_trip_id and s.user_id = v_person
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
