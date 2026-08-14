create or replace function public.upsert_coach_application_draft(
  checked_primary_sport_id uuid,
  checked_service_region text,
  checked_headline text,
  checked_bio text,
  checked_career_years integer,
  checked_bank_name text,
  checked_bank_account_last4 text,
  checked_payout_holder_name text
)
returns setof public.coach_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  checked_owner_id uuid := (select auth.uid());
  selected_profile public.profiles%rowtype;
  saved_profile public.coach_profiles%rowtype;
begin
  if checked_owner_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select profiles.*
  into selected_profile
  from public.profiles
  where profiles.id = checked_owner_id
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
  if selected_profile.role <> 'learner' or selected_profile.status <> 'active' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coach_profiles.*
  into saved_profile
  from public.coach_profiles
  where coach_profiles.user_id = checked_owner_id
  for update;

  if found and saved_profile.status not in ('draft', 'rejected') then
    raise exception 'COACH_APPLICATION_CONFLICT' using errcode = 'P0001';
  end if;

  if checked_service_region is null
    or char_length(btrim(checked_service_region)) not between 1 and 100
    or checked_headline is null
    or char_length(btrim(checked_headline)) not between 1 and 120
    or checked_bio is null
    or char_length(btrim(checked_bio)) not between 1 and 5000
    or checked_career_years is null
    or checked_career_years not between 0 and 100
    or checked_bank_name is null
    or char_length(btrim(checked_bank_name)) not between 1 and 100
    or checked_bank_account_last4 is null
    or checked_bank_account_last4 !~ '^[0-9]{4}$'
    or checked_payout_holder_name is null
    or char_length(btrim(checked_payout_holder_name)) not between 1 and 100
    or checked_primary_sport_id is null
    or not exists (
      select 1
      from public.sports
      where sports.id = checked_primary_sport_id and sports.is_active
    )
  then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  insert into public.coach_profiles (
    user_id, primary_sport_id, service_region, headline, bio, career_years,
    bank_name, bank_account_last4, payout_holder_name
  ) values (
    checked_owner_id, checked_primary_sport_id, btrim(checked_service_region),
    btrim(checked_headline), btrim(checked_bio), checked_career_years,
    btrim(checked_bank_name), checked_bank_account_last4, btrim(checked_payout_holder_name)
  )
  on conflict (user_id) do update set
    primary_sport_id = excluded.primary_sport_id,
    service_region = excluded.service_region,
    headline = excluded.headline,
    bio = excluded.bio,
    career_years = excluded.career_years,
    bank_name = excluded.bank_name,
    bank_account_last4 = excluded.bank_account_last4,
    payout_holder_name = excluded.payout_holder_name
  returning * into saved_profile;

  return next saved_profile;
end;
$$;

revoke execute on function public.upsert_coach_application_draft(
  uuid, text, text, text, integer, text, text, text
) from public, anon;
grant execute on function public.upsert_coach_application_draft(
  uuid, text, text, text, integer, text, text, text
) to authenticated;
