create or replace function public.withdraw_current_account()
returns table (
  account_id uuid,
  deleted_at timestamptz,
  idempotent boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_profile public.profiles%rowtype;
  withdrawal_time timestamptz := statement_timestamp();
begin
  if actor_id is null then
    raise exception 'Authenticated account required.' using errcode = '42501';
  end if;

  select profiles.* into selected_profile
  from public.profiles
  where profiles.id = actor_id
  for update;

  if not found then
    raise exception 'Profile required.' using errcode = 'P0002';
  end if;

  if selected_profile.status = 'deleted' or selected_profile.deleted_at is not null then
    return query select actor_id, selected_profile.deleted_at, true;
    return;
  end if;

  delete from public.lesson_favorites where learner_id = actor_id;
  delete from public.blocks where blocker_id = actor_id or blocked_id = actor_id;
  delete from public.notifications where user_id = actor_id;
  delete from public.push_subscriptions where user_id = actor_id;

  update public.coach_profiles
  set headline = null,
      bio = null,
      intro_video_url = null,
      bank_name = null,
      bank_account_last4 = null,
      payout_holder_name = null
  where user_id = actor_id;

  update public.profiles
  set status = 'deleted',
      display_name = '탈퇴한 사용자',
      real_name = null,
      phone = null,
      avatar_path = null,
      default_region = null,
      marketing_agreed_at = null,
      location_agreed_at = null,
      deleted_at = withdrawal_time
  where id = actor_id;

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, before_data, after_data
  ) values (
    actor_id,
    'account.withdrawn',
    'user',
    actor_id,
    jsonb_build_object('status', selected_profile.status),
    jsonb_build_object('status', 'deleted', 'deletedAt', withdrawal_time)
  );

  return query select actor_id, withdrawal_time, false;
end;
$$;

revoke all on function public.withdraw_current_account() from public, anon;
grant execute on function public.withdraw_current_account() to authenticated;

create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    old.role is distinct from new.role
    or old.deleted_at is distinct from new.deleted_at
  )
    and not public.is_admin()
    and current_user <> pg_catalog.pg_get_userbyid((
      select proowner
      from pg_catalog.pg_proc
      where oid = 'public.withdraw_current_account()'::pg_catalog.regprocedure
    )) then
    raise exception 'Only administrators can update profile system fields.'
      using errcode = '42501';
  end if;

  if old.status is distinct from new.status
    and not public.is_admin()
    and current_user <> 'service_role'
    and current_user <> pg_catalog.pg_get_userbyid((
      select proowner
      from pg_catalog.pg_proc
      where oid = 'public.submit_coach_application()'::pg_catalog.regprocedure
    )) then
    raise exception 'Only trusted certification workflows can update profile status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
