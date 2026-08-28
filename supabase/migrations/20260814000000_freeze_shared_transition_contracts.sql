create type public.lesson_status_action as enum (
  'submit',
  'pause',
  'resume',
  'close',
  'approve',
  'reject'
);

create type public.reservation_status_action as enum (
  'complete',
  'mark_learner_no_show',
  'mark_coach_no_show',
  'open_dispute',
  'cancel'
);

create type public.report_status_action as enum ('start_review', 'resolve', 'reject');
create type public.settlement_status_action as enum ('approve', 'hold');
create type public.refund_result_action as enum ('complete', 'fail');

create type public.report_target_type as enum (
  'user',
  'coach',
  'lesson',
  'review',
  'reservation'
);

create type public.notification_type as enum (
  'coach_certification.submitted',
  'coach_certification.reviewed',
  'reservation_confirmed',
  'reservation_cancelled',
  'reservation.completed',
  'reservation.no_show',
  'review.requested',
  'report.resolved',
  'refund.result',
  'settlement.status_changed'
);

alter table public.reports
  drop constraint if exists reports_target_type_check;

alter table public.reports
  alter column target_type type public.report_target_type
  using target_type::public.report_target_type;

drop index if exists public.coach_certification_review_notification_once_idx;

alter table public.notifications
  alter column type type public.notification_type
  using type::public.notification_type;

create unique index coach_certification_review_notification_once_idx
on public.notifications (
  user_id,
  ((data ->> 'coachProfileId')),
  ((data ->> 'submittedAt'))
)
where type = 'coach_certification.reviewed'::public.notification_type;

alter table public.reports
  add constraint reports_reason_bounded_check
  check (char_length(public.js_trim(reason)) between 1 and 100),
  add constraint reports_detail_bounded_check
  check (
    detail is null
    or char_length(public.js_trim(detail)) between 1 and 1000
  );

alter table public.blocks
  add constraint blocks_reason_bounded_check
  check (
    reason is null
    or char_length(public.js_trim(reason)) between 1 and 200
  );

alter table public.reviews
  add constraint reviews_content_bounded_check
  check (
    content is null
    or char_length(public.js_trim(content)) between 1 and 2000
  );

alter table public.settlements
  add constraint settlements_amount_equation_check
  check (
    net_amount = gross_amount - platform_fee_amount - payment_fee_amount - refund_amount
  ),
  add constraint settlements_deductions_bounded_check
  check (platform_fee_amount + payment_fee_amount + refund_amount <= gross_amount);

create or replace function public.notification_data_is_safe(
  checked_type public.notification_type,
  checked_data jsonb
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select checked_data is not null
    and jsonb_typeof(checked_data) = 'object'
    and not exists (
      select 1
      from jsonb_each(checked_data) as entry
      where jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null')
    )
    and case checked_type
      when 'coach_certification.submitted' then
        checked_data ?& array['coachProfileId', 'submittedAt']
        and checked_data - array['coachProfileId', 'submittedAt'] = '{}'::jsonb
      when 'coach_certification.reviewed' then
        checked_data ?& array['coachProfileId', 'decision', 'submittedAt']
        and checked_data - array['coachProfileId', 'decision', 'submittedAt'] = '{}'::jsonb
      when 'reservation_confirmed' then
        checked_data ?& array['reservationId', 'paymentId']
        and checked_data - array['reservationId', 'paymentId'] = '{}'::jsonb
      when 'reservation_cancelled' then
        checked_data ?& array['reservationId', 'status']
        and checked_data - array['reservationId', 'status'] = '{}'::jsonb
      when 'reservation.completed' then
        checked_data ?& array['reservationId']
        and checked_data - array['reservationId'] = '{}'::jsonb
      when 'reservation.no_show' then
        checked_data ?& array['reservationId', 'status']
        and checked_data - array['reservationId', 'status'] = '{}'::jsonb
      when 'review.requested' then
        checked_data ?& array['reservationId', 'lessonId']
        and checked_data - array['reservationId', 'lessonId'] = '{}'::jsonb
      when 'report.resolved' then
        checked_data ?& array['reportId', 'status']
        and checked_data - array['reportId', 'status'] = '{}'::jsonb
      when 'refund.result' then
        checked_data ?& array['refundId', 'reservationId', 'status']
        and checked_data - array['refundId', 'reservationId', 'status'] = '{}'::jsonb
      when 'settlement.status_changed' then
        checked_data ?& array['settlementId', 'reservationId', 'status']
        and checked_data - array['settlementId', 'reservationId', 'status'] = '{}'::jsonb
    end;
$$;

revoke all on function public.notification_data_is_safe(public.notification_type, jsonb)
from public, anon, authenticated;

alter table public.notifications
  add constraint notifications_title_bounded_check
  check (char_length(public.js_trim(title)) between 1 and 120),
  add constraint notifications_body_bounded_check
  check (
    body is null
    or char_length(public.js_trim(body)) between 1 and 1000
  ),
  add constraint notifications_data_allowlist_check
  check (public.notification_data_is_safe(type, data));

create or replace function public.is_approved_coach(checked_coach_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.coach_profiles
    join public.profiles on profiles.id = coach_profiles.user_id
    where coach_profiles.id = checked_coach_profile_id
      and coach_profiles.status = 'approved'
      and profiles.status = 'coach_approved'
      and profiles.deleted_at is null
  );
$$;

revoke all on function public.is_approved_coach(uuid) from public, anon;
grant execute on function public.is_approved_coach(uuid) to authenticated;

create or replace function public.no_show_wait_interval()
returns interval
language sql
immutable
set search_path = pg_catalog
as $$
  select interval '15 minutes';
$$;

create or replace function public.reservation_no_show_available_at(checked_starts_at timestamptz)
returns timestamptz
language sql
immutable
strict
set search_path = public
as $$
  select checked_starts_at + public.no_show_wait_interval();
$$;

revoke all on function public.no_show_wait_interval() from public, anon, authenticated;
revoke all on function public.reservation_no_show_available_at(timestamptz)
from public, anon, authenticated;

create or replace function public.protect_lesson_review_status()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from new.status
    and current_user not in ('postgres', 'service_role') then
    raise exception 'Only trusted lesson workflows can update lesson status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.protect_schedule_transition_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.reserved_count is distinct from new.reserved_count
    and current_user not in ('postgres', 'service_role') then
    raise exception 'Only trusted reservation workflows can update reserved_count.'
      using errcode = '42501';
  end if;

  if (
    old.lesson_id is distinct from new.lesson_id
    or old.starts_at is distinct from new.starts_at
    or old.ends_at is distinct from new.ends_at
    or old.capacity is distinct from new.capacity
  ) and exists (
    select 1
    from public.reservations
    where reservations.lesson_schedule_id = old.id
      and reservations.status in (
        'confirmed', 'completed', 'no_show_user', 'no_show_coach', 'disputed'
      )
  ) then
    raise exception 'A schedule with a confirmed reservation is locked.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists lesson_schedules_protect_reserved_count on public.lesson_schedules;
create trigger lesson_schedules_protect_transition_fields
before update on public.lesson_schedules
for each row execute function public.protect_schedule_transition_fields();

create or replace function public.protect_reservation_transition_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  selected_starts_at timestamptz;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Only trusted reservation workflows can update reservations.'
      using errcode = '42501';
  end if;

  if old.status is distinct from new.status
    and new.status in ('no_show_user', 'no_show_coach') then
    select lesson_schedules.starts_at
    into selected_starts_at
    from public.lesson_schedules
    where lesson_schedules.id = new.lesson_schedule_id
    for update;

    if not found
      or statement_timestamp() < public.reservation_no_show_available_at(selected_starts_at) then
      raise exception 'No-show can be recorded 15 minutes after the schedule starts.'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

create trigger reservations_protect_transition_fields
before update on public.reservations
for each row execute function public.protect_reservation_transition_fields();

create or replace function public.protect_notification_read_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not (
    old.user_id = (select auth.uid())
    and new.id = old.id
    and new.user_id = old.user_id
    and new.type = old.type
    and new.title = old.title
    and new.body is not distinct from old.body
    and new.data is not distinct from old.data
    and old.read_at is null
    and new.read_at is not null
    and new.created_at = old.created_at
  ) then
    raise exception 'Users can only mark their own unread notifications as read.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop policy if exists "lessons_insert_owner" on public.lessons;
create policy "lessons_insert_approved_owner" on public.lessons
for insert to authenticated
with check (
  public.owns_coach_profile(coach_profile_id)
  and public.is_approved_coach(coach_profile_id)
  and status = 'draft'
);

drop policy if exists "lessons_update_owner_or_admin" on public.lessons;
create policy "lessons_update_approved_owner" on public.lessons
for update to authenticated
using (
  public.owns_coach_profile(coach_profile_id)
  and public.is_approved_coach(coach_profile_id)
)
with check (
  public.owns_coach_profile(coach_profile_id)
  and public.is_approved_coach(coach_profile_id)
);

drop policy if exists "lesson_schedules_insert_owner" on public.lesson_schedules;
create policy "lesson_schedules_insert_approved_owner" on public.lesson_schedules
for insert to authenticated
with check (
  public.owns_lesson(lesson_id)
  and public.is_approved_coach((
    select lessons.coach_profile_id from public.lessons where lessons.id = lesson_id
  ))
  and reserved_count = 0
);

drop policy if exists "lesson_schedules_update_owner_or_admin" on public.lesson_schedules;
create policy "lesson_schedules_update_approved_owner" on public.lesson_schedules
for update to authenticated
using (
  public.owns_lesson(lesson_id)
  and public.is_approved_coach((
    select lessons.coach_profile_id from public.lessons where lessons.id = lesson_id
  ))
)
with check (
  public.owns_lesson(lesson_id)
  and public.is_approved_coach((
    select lessons.coach_profile_id from public.lessons where lessons.id = lesson_id
  ))
);

drop policy if exists "reservations_update_admin" on public.reservations;
drop policy if exists "reviews_update_admin" on public.reviews;
drop policy if exists "reports_update_admin" on public.reports;

drop policy if exists "notifications_update_read_or_admin" on public.notifications;
create policy "notifications_update_read_owner" on public.notifications
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke insert, update, delete on public.lessons from anon, authenticated;
revoke insert, update, delete on public.lesson_images from anon, authenticated;
revoke insert, update, delete on public.lesson_schedules from anon, authenticated;
revoke insert, update, delete on public.reservations from anon, authenticated;
revoke insert, update, delete on public.settlements from anon, authenticated;
revoke insert, update, delete on public.reviews from anon, authenticated;
revoke insert, update, delete on public.lesson_favorites from anon, authenticated;
revoke insert, update, delete on public.reports from anon, authenticated;
revoke insert, update, delete on public.blocks from anon, authenticated;
revoke insert, update, delete on public.notifications from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
