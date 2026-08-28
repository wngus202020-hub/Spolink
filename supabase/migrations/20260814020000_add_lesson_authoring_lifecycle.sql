create or replace function public.require_approved_coach()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select coach_profiles.id
  into selected_coach_profile_id
  from public.coach_profiles
  join public.profiles on profiles.id = coach_profiles.user_id
  where coach_profiles.user_id = (select auth.uid())
    and coach_profiles.status = 'approved'
    and profiles.status = 'coach_approved'
    and profiles.deleted_at is null;

  if selected_coach_profile_id is null then
    raise exception 'COACH_NOT_APPROVED' using errcode = 'P0001';
  end if;

  return selected_coach_profile_id;
end;
$$;

revoke all on function public.require_approved_coach() from public, anon, authenticated;

create or replace function public.protect_lesson_review_status()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status
    and not (
      (
        public.owns_coach_profile(new.coach_profile_id)
        and (
          (old.status in ('draft', 'rejected') and new.status = 'pending_review')
          or (old.status = 'active' and new.status = 'paused')
          or (old.status = 'paused' and new.status = 'active')
          or (old.status = 'active' and new.status = 'closed')
        )
      )
      or (
        public.is_admin()
        and (
          (old.status = 'pending_review' and new.status = 'active')
          or (old.status = 'pending_review' and new.status = 'rejected')
        )
      )
    ) then
    raise exception 'Lesson status transition is not allowed.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.create_lesson_draft(
  checked_sport_id uuid,
  checked_title text,
  checked_summary text,
  checked_description text,
  checked_region text,
  checked_address text,
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

create or replace function public.transition_lesson(
  checked_lesson_id uuid,
  checked_action public.lesson_status_action,
  checked_expected_updated_at timestamptz,
  checked_reason text default null
)
returns setof public.lessons
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_lesson public.lessons;
  selected_coach_profile_id uuid;
  next_status public.lesson_status;
  previous_status public.lesson_status;
begin
  if actor_id is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  select * into selected_lesson
  from public.lessons
  where id = checked_lesson_id
  for update;
  if not found then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.updated_at <> checked_expected_updated_at then
    raise exception 'STALE_LESSON' using errcode = 'P0001';
  end if;
  previous_status := selected_lesson.status;

  if checked_action in ('approve', 'reject') then
    if not public.is_admin() then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    if selected_lesson.status <> 'pending_review' then
      raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
    end if;
    next_status := case checked_action when 'approve' then 'active' else 'rejected' end;
  else
    selected_coach_profile_id := public.require_approved_coach();
    if selected_lesson.coach_profile_id <> selected_coach_profile_id then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    next_status := case
      when checked_action = 'submit' and selected_lesson.status in ('draft', 'rejected')
        then 'pending_review'
      when checked_action = 'pause' and selected_lesson.status = 'active' then 'paused'
      when checked_action = 'resume' and selected_lesson.status = 'paused' then 'active'
      when checked_action = 'close' and selected_lesson.status = 'active' then 'closed'
      else null
    end;
    if next_status is null then
      raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

  if checked_action = 'reject'
    and (checked_reason is null or char_length(public.js_trim(checked_reason)) not between 1 and 1000)
  then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  update public.lessons
  set status = next_status,
      paused_reason = case
        when checked_action in ('pause', 'reject') then nullif(public.js_trim(checked_reason), '')
        else null
      end,
      updated_at = statement_timestamp()
  where id = selected_lesson.id
  returning * into selected_lesson;

  insert into public.audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data
  ) values (
    actor_id,
    'lesson.' || checked_action::text,
    'lesson',
    selected_lesson.id,
    jsonb_build_object('status', previous_status),
    jsonb_build_object('status', next_status)
  );

  return next selected_lesson;
end;
$$;

create or replace function public.create_lesson_schedule(
  checked_lesson_id uuid,
  checked_starts_at timestamptz,
  checked_ends_at timestamptz,
  checked_capacity integer
)
returns setof public.lesson_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  created_schedule public.lesson_schedules;
begin
  selected_coach_profile_id := public.require_approved_coach();
  select * into selected_lesson from public.lessons where id = checked_lesson_id for update;
  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.status not in ('draft', 'rejected', 'active', 'paused') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;
  if checked_starts_at is null or checked_ends_at <= checked_starts_at
    or checked_starts_at <= statement_timestamp()
    or checked_capacity not between 1 and 100 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  insert into public.lesson_schedules (
    lesson_id,
    starts_at,
    ends_at,
    capacity,
    reserved_count,
    is_open
  ) values (
    checked_lesson_id,
    checked_starts_at,
    checked_ends_at,
    checked_capacity,
    0,
    true
  ) returning * into created_schedule;
  return next created_schedule;
end;
$$;

create or replace function public.update_lesson_schedule(
  checked_lesson_id uuid,
  checked_schedule_id uuid,
  checked_expected_updated_at timestamptz,
  checked_starts_at timestamptz,
  checked_ends_at timestamptz,
  checked_capacity integer
)
returns setof public.lesson_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_schedule public.lesson_schedules;
  selected_lesson public.lessons;
begin
  selected_coach_profile_id := public.require_approved_coach();
  select * into selected_schedule
  from public.lesson_schedules
  where id = checked_schedule_id
  for update;
  if not found or selected_schedule.lesson_id <> checked_lesson_id then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into selected_lesson from public.lessons where id = selected_schedule.lesson_id;
  if selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_schedule.updated_at <> checked_expected_updated_at or not selected_schedule.is_open then
    raise exception 'STALE_SCHEDULE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservations
    where lesson_schedule_id = selected_schedule.id
      and status in ('confirmed', 'completed', 'no_show_user', 'no_show_coach', 'disputed')
  ) then
    raise exception 'SCHEDULE_HAS_CONFIRMED_RESERVATION' using errcode = 'P0001';
  end if;
  if checked_starts_at is null or checked_ends_at <= checked_starts_at
    or checked_starts_at <= statement_timestamp()
    or checked_capacity < selected_schedule.reserved_count
    or checked_capacity not between 1 and 100 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  update public.lesson_schedules
  set starts_at = checked_starts_at,
      ends_at = checked_ends_at,
      capacity = checked_capacity,
      updated_at = statement_timestamp()
  where id = selected_schedule.id
  returning * into selected_schedule;
  return next selected_schedule;
end;
$$;

create or replace function public.close_lesson_schedule(
  checked_lesson_id uuid,
  checked_schedule_id uuid,
  checked_expected_updated_at timestamptz
)
returns setof public.lesson_schedules
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_schedule public.lesson_schedules;
  selected_lesson public.lessons;
begin
  selected_coach_profile_id := public.require_approved_coach();
  select * into selected_schedule
  from public.lesson_schedules
  where id = checked_schedule_id
  for update;
  if not found or selected_schedule.lesson_id <> checked_lesson_id then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into selected_lesson from public.lessons where id = selected_schedule.lesson_id;
  if selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_schedule.updated_at <> checked_expected_updated_at or not selected_schedule.is_open then
    raise exception 'STALE_SCHEDULE' using errcode = 'P0001';
  end if;

  update public.lesson_schedules
  set is_open = false,
      updated_at = statement_timestamp()
  where id = selected_schedule.id
  returning * into selected_schedule;
  return next selected_schedule;
end;
$$;

revoke all on function public.create_lesson_draft(
  uuid, text, text, text, text, text, text, integer, integer, integer, text, text
) from public, anon;
revoke all on function public.update_lesson_draft(
  uuid, timestamptz, uuid, text, text, text, text, text, text, integer, integer, integer, text, text
) from public, anon;
revoke all on function public.transition_lesson(
  uuid, public.lesson_status_action, timestamptz, text
) from public, anon;
revoke all on function public.create_lesson_schedule(uuid, timestamptz, timestamptz, integer)
from public, anon;
revoke all on function public.update_lesson_schedule(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
) from public, anon;
revoke all on function public.close_lesson_schedule(uuid, uuid, timestamptz) from public, anon;

grant execute on function public.create_lesson_draft(
  uuid, text, text, text, text, text, text, integer, integer, integer, text, text
) to authenticated;
grant execute on function public.update_lesson_draft(
  uuid, timestamptz, uuid, text, text, text, text, text, text, integer, integer, integer, text, text
) to authenticated;
grant execute on function public.transition_lesson(
  uuid, public.lesson_status_action, timestamptz, text
) to authenticated;
grant execute on function public.create_lesson_schedule(uuid, timestamptz, timestamptz, integer)
to authenticated;
grant execute on function public.update_lesson_schedule(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
) to authenticated;
grant execute on function public.close_lesson_schedule(uuid, uuid, timestamptz) to authenticated;
