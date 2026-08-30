-- Gas Split — initial schema.
--
-- Units and money, fixed once here so nothing downstream has to guess:
--   * odometer readings and distances are WHOLE KILOMETRES, stored as integer
--   * money is INTEGER CENTS
--   * no floating point is stored anywhere
--
-- A settlement period is "every trip of a car whose fill_id is null". Recording
-- a fuel fill stamps those trips with the fill id rather than deleting them,
-- which both empties the dashboard and keeps the history auditable.

-- ---------------------------------------------------------------------------
-- profiles: a readable mirror of auth.users, so members can see each other
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Mirror of auth.users maintained by the handle_new_user trigger.';

-- Derives a display name from whatever the auth provider gave us.
create or replace function public.derive_display_name(
  p_email text,
  p_meta  jsonb
)
returns text
language sql
immutable
as $fn$
  select coalesce(
    nullif(btrim(p_meta ->> 'display_name'), ''),
    nullif(btrim(p_meta ->> 'full_name'), ''),
    nullif(btrim(p_meta ->> 'name'), ''),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'Member'
  );
$fn$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    left(public.derive_display_name(new.email, new.raw_user_meta_data), 60),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keeps the mirror fresh when the user changes their email or provider profile.
create or replace function public.handle_user_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.profiles p
  set email        = coalesce(new.email, p.email),
      display_name = left(
        public.derive_display_name(new.email, new.raw_user_meta_data), 60
      ),
      avatar_url   = coalesce(
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture',
        p.avatar_url
      ),
      updated_at   = now()
  where p.id = new.id;
  return new;
end;
$fn$;

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_user_update();

-- The trigger only fires on new signups, so anyone who registered before this
-- migration ran — while the project was being set up, say — would have no
-- profile and be invisible to their own group. Backfill them.
insert into public.profiles (id, email, display_name, avatar_url)
select
  u.id,
  coalesce(u.email, ''),
  left(public.derive_display_name(u.email, u.raw_user_meta_data), 60),
  coalesce(
    u.raw_user_meta_data ->> 'avatar_url',
    u.raw_user_meta_data ->> 'picture'
  )
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- cars
-- ---------------------------------------------------------------------------

create table public.cars (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 1 and 60),
  currency            text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  initial_odometer_km integer not null default 0 check (initial_odometer_km >= 0),
  created_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now()
);

create table public.memberships (
  car_id    uuid not null references public.cars (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (car_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- Whoever creates a car is its first member, and its owner.
create or replace function public.handle_new_car()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.memberships (car_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$fn$;

create trigger on_car_created
  after insert on public.cars
  for each row execute function public.handle_new_car();

-- ---------------------------------------------------------------------------
-- invites: a QR code or emailed link carries the raw token; only its hash is
-- stored, so a leaked database row cannot be used to join a car.
-- ---------------------------------------------------------------------------

create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  car_id        uuid not null references public.cars (id) on delete cascade,
  token_hash    text not null unique,
  invited_email text,
  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_by   uuid references public.profiles (id),
  accepted_at   timestamptz,
  constraint invites_accepted_together check (
    (accepted_by is null) = (accepted_at is null)
  )
);

create index invites_car_id_idx on public.invites (car_id);

-- ---------------------------------------------------------------------------
-- fills: created before trips because trips reference the fill that closed them
-- ---------------------------------------------------------------------------

create table public.fills (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references public.cars (id) on delete cascade,
  paid_by     uuid not null references public.profiles (id),
  total_cents integer not null check (total_cents > 0),
  odometer_km integer check (odometer_km >= 0),
  filled_on   date not null,
  created_at  timestamptz not null default now()
);

create index fills_car_id_created_at_idx on public.fills (car_id, created_at desc);

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------

create table public.trips (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references public.cars (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  start_km    integer not null check (start_km >= 0),
  end_km      integer not null,
  distance_km integer generated always as (end_km - start_km) stored,
  driven_on   date not null,
  note        text check (note is null or length(note) <= 200),
  fill_id     uuid references public.fills (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint trips_distance_positive check (end_km > start_km)
);

-- The dashboard reads the open period constantly; keep that lookup cheap.
create index trips_open_period_idx on public.trips (car_id) where fill_id is null;
create index trips_car_id_fill_id_idx on public.trips (car_id, fill_id);
-- Autofilling the start reading is a max(end_km) over the car.
create index trips_car_id_end_km_idx on public.trips (car_id, end_km desc);

-- One row per participant in a trip. A solo drive has exactly one row (the
-- driver); a split drive has one per selected member, and the distance is
-- divided equally between them.
create table public.trip_shares (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (trip_id, user_id)
);

create index trip_shares_user_id_idx on public.trip_shares (user_id);

-- A trip with no participants would silently vanish from every aggregation.
-- Deferred, so a transaction can insert the trip and then its shares.
create or replace function public.assert_trip_has_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.trip_shares s where s.trip_id = new.id
  ) then
    raise exception 'trip % has no participants', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$fn$;

create constraint trigger trips_require_shares
  after insert on public.trips
  deferrable initially deferred
  for each row execute function public.assert_trip_has_shares();

-- ---------------------------------------------------------------------------
-- fill_shares: the immutable settlement snapshot
--
-- km is kept as an exact rational (km_scaled / km_scale) rather than a decimal.
-- A three-way split of a 100 km trip is 100/3 km each, which no decimal column
-- can hold exactly; rounding only ever happens once, on the money.
-- ---------------------------------------------------------------------------

create table public.fill_shares (
  fill_id      uuid not null references public.fills (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  km_scaled    bigint not null check (km_scaled >= 0),
  km_scale     integer not null check (km_scale > 0),
  amount_cents integer not null check (amount_cents >= 0),
  primary key (fill_id, user_id)
);

create index fill_shares_user_id_idx on public.fill_shares (user_id);

comment on column public.fill_shares.km_scaled is
  'Kilometres driven in the period, multiplied by km_scale to stay exact.';

-- ---------------------------------------------------------------------------
-- Read helpers
--
-- security_invoker means the RLS of whoever queries the view applies, so these
-- only ever expose cars that caller belongs to.
-- ---------------------------------------------------------------------------

-- Kilometres per member in the open period, for display on the dashboard.
create view public.open_period_km
with (security_invoker = on) as
select
  t.car_id,
  s.user_id,
  sum(t.distance_km::numeric / participants.n) as km,
  count(*)                                     as trip_count
from public.trips t
join public.trip_shares s on s.trip_id = t.id
join lateral (
  select count(*)::int as n
  from public.trip_shares x
  where x.trip_id = t.id
) participants on true
where t.fill_id is null
group by t.car_id, s.user_id;

comment on view public.open_period_km is
  'Display figures only. Settlement recomputes the same numbers in exact integers.';

-- The reading to prefill "start distance" with.
create view public.car_odometer
with (security_invoker = on) as
select
  c.id as car_id,
  greatest(c.initial_odometer_km, coalesce(max(t.end_km), 0)) as last_km
from public.cars c
left join public.trips t on t.car_id = c.id
group by c.id, c.initial_odometer_km;
