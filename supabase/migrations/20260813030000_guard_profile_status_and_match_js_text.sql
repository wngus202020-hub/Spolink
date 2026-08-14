create or replace function public.js_trim(checked_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select pg_catalog.btrim(
    checked_value,
    pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
      || pg_catalog.chr(12) || pg_catalog.chr(13) || pg_catalog.chr(32)
      || pg_catalog.chr(160) || pg_catalog.chr(5760)
      || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194)
      || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197)
      || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200)
      || pg_catalog.chr(8201) || pg_catalog.chr(8202)
      || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
      || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279)
  );
$$;

create or replace function public.js_utf16_length(checked_value text)
returns integer
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  checked_length integer := 0;
  checked_index integer;
begin
  for checked_index in 1..pg_catalog.char_length(checked_value) loop
    checked_length := checked_length + case
      when pg_catalog.ascii(pg_catalog.substr(checked_value, checked_index, 1)) > 65535 then 2
      else 1
    end;
  end loop;

  return checked_length;
end;
$$;

revoke all on function public.js_trim(text) from public, anon, authenticated;
revoke all on function public.js_utf16_length(text) from public, anon, authenticated;

create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    old.role is distinct from new.role
    or old.deleted_at is distinct from new.deleted_at
  ) and not public.is_admin() then
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
  trimmed_service_region text := public.js_trim(checked_service_region);
  trimmed_headline text := public.js_trim(checked_headline);
  trimmed_bio text := public.js_trim(checked_bio);
  trimmed_bank_name text := public.js_trim(checked_bank_name);
  trimmed_payout_holder_name text := public.js_trim(checked_payout_holder_name);
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

  if trimmed_service_region is null
    or public.js_utf16_length(trimmed_service_region) not between 1 and 100
    or trimmed_headline is null
    or public.js_utf16_length(trimmed_headline) not between 1 and 120
    or trimmed_bio is null
    or public.js_utf16_length(trimmed_bio) not between 1 and 5000
    or checked_career_years is null
    or checked_career_years not between 0 and 100
    or trimmed_bank_name is null
    or public.js_utf16_length(trimmed_bank_name) not between 1 and 100
    or checked_bank_account_last4 is null
    or checked_bank_account_last4 !~ '^[0-9]{4}$'
    or trimmed_payout_holder_name is null
    or public.js_utf16_length(trimmed_payout_holder_name) not between 1 and 100
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
    checked_owner_id, checked_primary_sport_id, trimmed_service_region,
    trimmed_headline, trimmed_bio, checked_career_years,
    trimmed_bank_name, checked_bank_account_last4, trimmed_payout_holder_name
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
