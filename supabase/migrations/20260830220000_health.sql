-- A query that exists to be run on a schedule.
--
-- Supabase pauses a free project after about a week without database activity,
-- and this app is used sporadically by design: a group can easily go a fortnight
-- without logging a trip and come back to a paused project. A daily call to this
-- keeps it awake.
--
-- It has to be a real database round trip. Loading a page is not enough — the
-- proxy's session check talks to the auth server, not to Postgres — so the
-- keep-alive calls this and nothing else.
--
-- Invoker rights, and it reads no tables, so `anon` calling it learns the time
-- and nothing about anyone's car.

create or replace function public.health()
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object('ok', true, 'at', now());
$fn$;

revoke execute on function public.health() from public;
grant execute on function public.health() to anon, authenticated;

comment on function public.health() is
  'Keeps a free Supabase project from pausing. Reads nothing.';
