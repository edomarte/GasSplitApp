-- Gas Split — row level security.
--
-- The rule everywhere: you can see and touch a car only if you are a member of
-- it. RLS is the authorization boundary, not the application code.
--
-- Two things are deliberately NOT writable by clients:
--   * fills and fill_shares — settlement has to be atomic, so it goes through a
--     security definer function added in a later migration
--   * memberships — you join a car by redeeming an invite, also via a function
-- Both tables therefore have read policies only. Anything without a policy for
-- an action is denied, which is the behaviour we want.

-- ---------------------------------------------------------------------------
-- Membership helpers.
--
-- These are security definer on purpose: a policy on memberships that itself
-- queries memberships would recurse forever. Fully qualified names plus an
-- empty search_path keep them from being hijacked by a caller-set schema.
-- ---------------------------------------------------------------------------

create or replace function public.is_car_member(p_car_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.memberships m
    where m.car_id = p_car_id
      and m.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.is_car_owner(p_car_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.memberships m
    where m.car_id = p_car_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$fn$;

create or replace function public.shares_car_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.car_id = mine.car_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$fn$;

revoke execute on function public.is_car_member(uuid) from public;
revoke execute on function public.is_car_owner(uuid) from public;
revoke execute on function public.shares_car_with(uuid) from public;
grant execute on function public.is_car_member(uuid) to authenticated;
grant execute on function public.is_car_owner(uuid) to authenticated;
grant execute on function public.shares_car_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Table grants.
--
-- RLS narrows what a role may touch; it cannot widen it. A Supabase project
-- grants these to authenticated by default, but spelling them out keeps the
-- schema self-contained and makes the read-only tables obvious: memberships,
-- fills and fill_shares are never written by a client.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, update                 on public.profiles      to authenticated;
grant select, insert, update, delete on public.cars          to authenticated;
grant select, delete                 on public.memberships   to authenticated;
grant select, insert, delete         on public.invites       to authenticated;
grant select, insert, update, delete on public.trips         to authenticated;
grant select, insert, delete         on public.trip_shares   to authenticated;
grant select                         on public.fills         to authenticated;
grant select                         on public.fill_shares   to authenticated;
grant select                         on public.open_period_km to authenticated;
grant select                         on public.car_odometer   to authenticated;

-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.cars         enable row level security;
alter table public.memberships  enable row level security;
alter table public.invites      enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_shares  enable row level security;
alter table public.fills        enable row level security;
alter table public.fill_shares  enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy "profiles are visible to yourself and your co-members"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_car_with(id));

create policy "you can edit your own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert or delete policy: rows follow auth.users via trigger and cascade.

-- ---------------------------------------------------------------------------
-- cars
-- ---------------------------------------------------------------------------

create policy "members can see their cars"
  on public.cars for select to authenticated
  using (public.is_car_member(id));

create policy "you can create a car for yourself"
  on public.cars for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "owners can edit a car"
  on public.cars for update to authenticated
  using (public.is_car_owner(id))
  with check (public.is_car_owner(id));

create policy "owners can delete a car"
  on public.cars for delete to authenticated
  using (public.is_car_owner(id));

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------

create policy "members can see who else is in the car"
  on public.memberships for select to authenticated
  using (public.is_car_member(car_id));

-- Joining happens by redeeming an invite, so there is no insert policy.

create policy "owners can remove members, and anyone can leave"
  on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_car_owner(car_id)
  );

-- ---------------------------------------------------------------------------
-- invites
--
-- Redeeming an invite is done by a security definer function: the person
-- holding the token is not a member yet, so no select policy could match them.
-- ---------------------------------------------------------------------------

create policy "members can see invites for their car"
  on public.invites for select to authenticated
  using (public.is_car_member(car_id));

create policy "members can invite others"
  on public.invites for insert to authenticated
  with check (
    public.is_car_member(car_id)
    and created_by = (select auth.uid())
  );

create policy "the inviter or an owner can revoke an invite"
  on public.invites for delete to authenticated
  using (
    created_by = (select auth.uid())
    or public.is_car_owner(car_id)
  );

-- ---------------------------------------------------------------------------
-- trips
--
-- Settled trips (fill_id is not null) are frozen: they are the evidence behind
-- a settlement that has already been emailed out.
-- ---------------------------------------------------------------------------

create policy "members can see the trips of their car"
  on public.trips for select to authenticated
  using (public.is_car_member(car_id));

create policy "members can record their own trips"
  on public.trips for insert to authenticated
  with check (
    public.is_car_member(car_id)
    and recorded_by = (select auth.uid())
    and fill_id is null
  );

create policy "you can edit your own unsettled trips"
  on public.trips for update to authenticated
  using (
    recorded_by = (select auth.uid())
    and fill_id is null
    and public.is_car_member(car_id)
  )
  with check (
    recorded_by = (select auth.uid())
    and fill_id is null
    and public.is_car_member(car_id)
  );

create policy "you or an owner can delete an unsettled trip"
  on public.trips for delete to authenticated
  using (
    fill_id is null
    and (recorded_by = (select auth.uid()) or public.is_car_owner(car_id))
  );

-- ---------------------------------------------------------------------------
-- trip_shares
-- ---------------------------------------------------------------------------

create policy "members can see trip participants"
  on public.trip_shares for select to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and public.is_car_member(t.car_id)
    )
  );

create policy "the recorder sets the participants of an unsettled trip"
  on public.trip_shares for insert to authenticated
  with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.fill_id is null
        and t.recorded_by = (select auth.uid())
    )
    -- You can only split with people who are actually in the car.
    and exists (
      select 1 from public.trips t
      join public.memberships m on m.car_id = t.car_id
      where t.id = trip_id and m.user_id = trip_shares.user_id
    )
  );

create policy "the recorder can change the participants of an unsettled trip"
  on public.trip_shares for delete to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id
        and t.fill_id is null
        and t.recorded_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- fills and fill_shares: readable by members, written only by the settlement
-- function. No insert, update or delete policies, so direct writes are denied.
-- ---------------------------------------------------------------------------

create policy "members can see the fills of their car"
  on public.fills for select to authenticated
  using (public.is_car_member(car_id));

create policy "members can see how a fill was split"
  on public.fill_shares for select to authenticated
  using (
    exists (
      select 1 from public.fills f
      where f.id = fill_id and public.is_car_member(f.car_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Nothing here is reachable without a session.
-- ---------------------------------------------------------------------------

revoke all on public.profiles     from anon;
revoke all on public.cars         from anon;
revoke all on public.memberships  from anon;
revoke all on public.invites      from anon;
revoke all on public.trips        from anon;
revoke all on public.trip_shares  from anon;
revoke all on public.fills        from anon;
revoke all on public.fill_shares  from anon;
revoke all on public.open_period_km from anon;
revoke all on public.car_odometer   from anon;
