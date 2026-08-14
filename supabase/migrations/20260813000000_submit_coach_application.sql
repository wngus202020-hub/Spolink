create or replace function public.protect_coach_review_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    old.reviewed_at is distinct from new.reviewed_at
    or old.reviewed_by is distinct from new.reviewed_by
    or old.rejection_reason is distinct from new.rejection_reason
    or (old.status is distinct from new.status and new.status in ('approved', 'rejected', 'suspended'))
    or (old.status in ('approved', 'suspended') and old.status is distinct from new.status)
  ) and not public.is_admin() and not (
    current_user = pg_get_userbyid((
      select proowner
      from pg_proc
      where oid = 'public.submit_coach_application()'::regprocedure
    ))
  ) then
    raise exception 'Only trusted certification workflows can update coach review fields.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.submit_coach_application()
returns table (
  coach_status public.coach_status,
  profile_role public.user_role,
  profile_status public.user_status,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  checked_user_id uuid := (select auth.uid());
  selected_profile public.profiles%rowtype;
  selected_coach_profile public.coach_profiles%rowtype;
  checked_submitted_at timestamptz := statement_timestamp();
begin
  if checked_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select profiles.*
  into selected_profile
  from public.profiles
  where profiles.id = checked_user_id
  for update;

  if not found then
    raise exception 'PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if selected_profile.deleted_at is not null or selected_profile.status = 'deleted' then
    raise exception 'ACCOUNT_DELETED' using errcode = 'P0001';
  end if;
  if selected_profile.status = 'suspended' then
    raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001';
  end if;
  if selected_profile.role <> 'learner' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coach_profiles.*
  into selected_coach_profile
  from public.coach_profiles
  where coach_profiles.user_id = checked_user_id
  for update;

  if not found then
    raise exception 'COACH_APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_profile.status <> 'active'
    or selected_coach_profile.status not in ('draft', 'rejected') then
    raise exception 'COACH_APPLICATION_CONFLICT' using errcode = 'P0001';
  end if;
  if selected_profile.real_name is null
    or btrim(selected_profile.real_name) = ''
    or selected_profile.phone is null
    or btrim(selected_profile.phone) = ''
    or selected_profile.avatar_path is null
    or btrim(selected_profile.avatar_path) = ''
    or selected_coach_profile.primary_sport_id is null
    or selected_coach_profile.headline is null
    or btrim(selected_coach_profile.headline) = ''
    or selected_coach_profile.bio is null
    or btrim(selected_coach_profile.bio) = ''
    or selected_coach_profile.service_region is null
    or btrim(selected_coach_profile.service_region) = ''
    or selected_coach_profile.career_years < 0
    or selected_coach_profile.bank_name is null
    or btrim(selected_coach_profile.bank_name) = ''
    or selected_coach_profile.bank_account_last4 is null
    or selected_coach_profile.bank_account_last4 !~ '^[0-9]{4}$'
    or selected_coach_profile.payout_holder_name is null
    or btrim(selected_coach_profile.payout_holder_name) = '' then
    raise exception 'COACH_APPLICATION_INCOMPLETE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.coach_certificates
    where coach_certificates.coach_profile_id = selected_coach_profile.id
  ) then
    raise exception 'COACH_CERTIFICATE_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.coach_certificates
    left join storage.objects
      on storage.objects.bucket_id = 'coach-certificates'
      and storage.objects.name = coach_certificates.file_path
    where coach_certificates.coach_profile_id = selected_coach_profile.id
      and (
        storage.objects.id is null
        or coach_certificates.rejected_reason is not null
        or split_part(coach_certificates.file_path, '/', 1) <> checked_user_id::text
        or coalesce(storage.objects.metadata ->> 'mimetype', '')
          not in ('image/png', 'image/jpeg', 'application/pdf')
        or coalesce((storage.objects.metadata ->> 'size')::bigint, 0) not between 1 and 10485760
      )
  ) then
    raise exception 'COACH_CERTIFICATE_INVALID' using errcode = 'P0001';
  end if;

  update public.coach_profiles
  set
    status = 'submitted',
    submitted_at = checked_submitted_at,
    reviewed_at = null,
    reviewed_by = null,
    rejection_reason = null
  where id = selected_coach_profile.id;

  update public.profiles
  set status = 'pending_coach'
  where id = checked_user_id;

  return query select
    'submitted'::public.coach_status,
    'learner'::public.user_role,
    'pending_coach'::public.user_status,
    checked_submitted_at;
end;
$$;

revoke insert, update on public.coach_profiles from authenticated;
revoke execute on function public.submit_coach_application() from public, anon;
grant execute on function public.submit_coach_application() to authenticated;
