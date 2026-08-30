-- Joining a car.
--
-- `memberships` has no insert policy, so this is the only way in. It has to be
-- security definer: the person holding an invite is not a member yet, so no
-- policy could match them, and they cannot even read the invite row to check it.
--
-- The raw token never reaches the database. The app hashes it and passes the
-- hash, so the stored value and the transmitted value are the same thing a
-- database leak would expose — useless without the link itself.
--
-- Invites are single use. A used one is spent even if the same person clicks
-- twice, so the redeem path answers idempotently for the member who claimed it.

-- ---------------------------------------------------------------------------
-- What an invited person may see before deciding to join.
--
-- Deliberately narrow: the car name and who invited them, and nothing else
-- about the car, its members or its history.
-- ---------------------------------------------------------------------------

create or replace function public.invite_preview(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_invite public.invites%rowtype;
  v_car    public.cars%rowtype;
  v_from   text;
begin
  select * into v_invite
  from public.invites i
  where i.token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_invite.accepted_by is not null then
    return jsonb_build_object('status', 'used');
  end if;

  if v_invite.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_car from public.cars c where c.id = v_invite.car_id;
  select p.display_name into v_from
  from public.profiles p
  where p.id = v_invite.created_by;

  return jsonb_build_object(
    'status', 'ok',
    'car_id', v_car.id,
    'car_name', v_car.name,
    'invited_by', coalesce(v_from, 'A member'),
    'already_member', public.is_car_member(v_car.id)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Redeeming an invite.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invite public.invites%rowtype;
  v_user   uuid := (select auth.uid());
begin
  if v_user is null then
    return jsonb_build_object('status', 'not_signed_in');
  end if;

  -- Lock the row: two people opening the same link at once must not both win.
  select * into v_invite
  from public.invites i
  where i.token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Already in the car, by this or any other route. Say so rather than failing:
  -- clicking your own invite twice should not look like an error.
  if exists (
    select 1 from public.memberships m
    where m.car_id = v_invite.car_id and m.user_id = v_user
  ) then
    return jsonb_build_object(
      'status', 'already_member',
      'car_id', v_invite.car_id
    );
  end if;

  if v_invite.accepted_by is not null then
    return jsonb_build_object('status', 'used');
  end if;

  if v_invite.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  insert into public.memberships (car_id, user_id, role)
  values (v_invite.car_id, v_user, 'member');

  update public.invites
  set accepted_by = v_user,
      accepted_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'status', 'joined',
    'car_id', v_invite.car_id
  );
end;
$fn$;

revoke execute on function public.invite_preview(text) from public;
revoke execute on function public.redeem_invite(text) from public;
grant execute on function public.invite_preview(text) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;

comment on function public.redeem_invite(text) is
  'The only way to gain a membership. Single use, locked against double claims.';
