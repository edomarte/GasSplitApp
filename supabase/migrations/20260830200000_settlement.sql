-- Settling a fill.
--
-- This is the only thing in the schema that turns kilometres into money, and it
-- has to be atomic: computing the split, writing it down, and closing the period
-- are one act. If any part landed without the others, the group would be looking
-- at a bill that does not match the trips behind it.
--
-- SECURITY DEFINER, for two reasons that are not negotiable:
--   * it stamps every open trip with the fill id, including trips recorded by
--     other people. The UPDATE policy on `trips` allows only the recorder.
--   * `fills` and `fill_shares` have no insert policies at all, deliberately, so
--     that this function is the only way a settlement can come into existence.
-- RLS is therefore bypassed here, and every check is made explicitly instead.

-- Postgres has lcm() for two arguments, but no aggregate form.
create or replace function public.lcm_bigint(a bigint, b bigint)
returns bigint
language sql
immutable
as $fn$
  select case when a = 0 or b = 0 then 0 else abs(a * b) / gcd(a, b) end;
$fn$;

-- ---------------------------------------------------------------------------
-- Exact arithmetic, start to finish.
--
-- A member's distance is a sum of fractions — a 100 km trip split three ways is
-- 100/3 each — and no decimal column holds that. So the period is scaled by the
-- lowest common multiple of the participant counts within it, which turns every
-- weight into a whole number. A solo trip plus a three-way split scales by 3; a
-- two-way plus a three-way scales by 6.
--
-- The money is then divided by largest remainder: everyone takes their whole
-- cents, and the leftovers go one at a time to whoever was cut back hardest.
-- The shares always sum to exactly what was paid.
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

revoke execute on function public.settle_fill(uuid, integer, date, uuid, integer) from public;
grant execute on function public.settle_fill(uuid, integer, date, uuid, integer) to authenticated;

comment on function public.settle_fill(uuid, integer, date, uuid, integer) is
  'The only way a fill and its shares are created. Atomic, and exact to the cent.';
