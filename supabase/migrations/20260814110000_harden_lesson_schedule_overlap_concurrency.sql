create extension if not exists btree_gist;

alter table public.lesson_schedules
  add constraint lesson_schedules_lesson_time_no_overlap
  exclude using gist (
    lesson_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  );

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
  select * into selected_lesson
  from public.lessons
  where id = checked_lesson_id
  for update;
  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into selected_schedule
  from public.lesson_schedules
  where id = checked_schedule_id
    and lesson_id = checked_lesson_id
  for update;
  if not found then
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
  select * into selected_lesson
  from public.lessons
  where id = checked_lesson_id
  for update;
  if not found then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'SCHEDULE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into selected_schedule
  from public.lesson_schedules
  where id = checked_schedule_id
    and lesson_id = checked_lesson_id
  for update;
  if not found then
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

revoke all on function public.update_lesson_schedule(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
) from public, anon;
revoke all on function public.close_lesson_schedule(uuid, uuid, timestamptz) from public, anon;

grant execute on function public.update_lesson_schedule(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
) to authenticated;
grant execute on function public.close_lesson_schedule(uuid, uuid, timestamptz) to authenticated;
