alter table public.lessons
  add constraint lessons_location_coordinates_check
  check (
    (latitude is null and longitude is null)
    or (
      address is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  );

drop function public.create_lesson_draft(
  uuid, text, text, text, text, text, text, integer, integer, integer, text, text
);
drop function public.update_lesson_draft(
  uuid, timestamptz, uuid, text, text, text, text, text, text,
  integer, integer, integer, text, text
);

create or replace function public.create_lesson_draft(
  checked_sport_id uuid,
  checked_title text,
  checked_summary text,
  checked_description text,
  checked_region text,
  checked_address text,
  checked_latitude numeric,
  checked_longitude numeric,
  checked_place_name text,
  checked_duration_minutes integer,
  checked_price_amount integer,
  checked_capacity integer,
  checked_preparation text,
  checked_cancellation_policy_summary text
)
returns setof public.lessons
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  created_lesson public.lessons;
begin
  selected_coach_profile_id := public.require_approved_coach();

  if checked_title is null or char_length(public.js_trim(checked_title)) not between 2 and 100
    or checked_description is null
    or char_length(public.js_trim(checked_description)) not between 10 and 3000
    or checked_region is null or char_length(public.js_trim(checked_region)) not between 2 and 100
    or checked_duration_minutes not between 10 and 480
    or checked_price_amount not between 0 and 10000000
    or checked_capacity not between 1 and 100
    or (checked_latitude is null) <> (checked_longitude is null)
    or checked_latitude not between -90 and 90
    or checked_longitude not between -180 and 180
    or (
      checked_latitude is not null
      and nullif(public.js_trim(checked_address), '') is null
    )
    or not exists (
      select 1 from public.sports where id = checked_sport_id and is_active
    ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  insert into public.lessons (
    coach_profile_id,
    sport_id,
    status,
    title,
    summary,
    description,
    region,
    address,
    latitude,
    longitude,
    place_name,
    duration_minutes,
    price_amount,
    capacity,
    preparation,
    cancellation_policy_summary
  ) values (
    selected_coach_profile_id,
    checked_sport_id,
    'draft',
    public.js_trim(checked_title),
    nullif(public.js_trim(checked_summary), ''),
    public.js_trim(checked_description),
    public.js_trim(checked_region),
    nullif(public.js_trim(checked_address), ''),
    checked_latitude,
    checked_longitude,
    nullif(public.js_trim(checked_place_name), ''),
    checked_duration_minutes,
    checked_price_amount,
    checked_capacity,
    nullif(public.js_trim(checked_preparation), ''),
    nullif(public.js_trim(checked_cancellation_policy_summary), '')
  ) returning * into created_lesson;

  return next created_lesson;
end;
$$;

create or replace function public.update_lesson_draft(
  checked_lesson_id uuid,
  checked_expected_updated_at timestamptz,
  checked_sport_id uuid,
  checked_title text,
  checked_summary text,
  checked_description text,
  checked_region text,
  checked_address text,
  checked_latitude numeric,
  checked_longitude numeric,
  checked_place_name text,
  checked_duration_minutes integer,
  checked_price_amount integer,
  checked_capacity integer,
  checked_preparation text,
  checked_cancellation_policy_summary text
)
returns setof public.lessons
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
begin
  selected_coach_profile_id := public.require_approved_coach();

  select * into selected_lesson
  from public.lessons
  where id = checked_lesson_id
  for update;

  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.updated_at <> checked_expected_updated_at then
    raise exception 'STALE_LESSON' using errcode = 'P0001';
  end if;
  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;
  if checked_title is null or char_length(public.js_trim(checked_title)) not between 2 and 100
    or checked_description is null
    or char_length(public.js_trim(checked_description)) not between 10 and 3000
    or checked_region is null or char_length(public.js_trim(checked_region)) not between 2 and 100
    or checked_duration_minutes not between 10 and 480
    or checked_price_amount not between 0 and 10000000
    or checked_capacity not between 1 and 100
    or (checked_latitude is null) <> (checked_longitude is null)
    or checked_latitude not between -90 and 90
    or checked_longitude not between -180 and 180
    or (
      checked_latitude is not null
      and nullif(public.js_trim(checked_address), '') is null
    )
    or not exists (
      select 1 from public.sports where id = checked_sport_id and is_active
    ) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  update public.lessons
  set sport_id = checked_sport_id,
      title = public.js_trim(checked_title),
      summary = nullif(public.js_trim(checked_summary), ''),
      description = public.js_trim(checked_description),
      region = public.js_trim(checked_region),
      address = nullif(public.js_trim(checked_address), ''),
      latitude = checked_latitude,
      longitude = checked_longitude,
      place_name = nullif(public.js_trim(checked_place_name), ''),
      duration_minutes = checked_duration_minutes,
      price_amount = checked_price_amount,
      capacity = checked_capacity,
      preparation = nullif(public.js_trim(checked_preparation), ''),
      cancellation_policy_summary = nullif(
        public.js_trim(checked_cancellation_policy_summary),
        ''
      ),
      updated_at = statement_timestamp()
  where id = checked_lesson_id
  returning * into selected_lesson;

  return next selected_lesson;
end;
$$;

revoke all on function public.create_lesson_draft(
  uuid, text, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text, text
) from public, anon;
revoke all on function public.update_lesson_draft(
  uuid, timestamptz, uuid, text, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text, text
) from public, anon;

grant execute on function public.create_lesson_draft(
  uuid, text, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text, text
) to authenticated;
grant execute on function public.update_lesson_draft(
  uuid, timestamptz, uuid, text, text, text, text, text, numeric, numeric, text,
  integer, integer, integer, text, text
) to authenticated;
