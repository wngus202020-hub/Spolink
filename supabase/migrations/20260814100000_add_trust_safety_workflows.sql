create type public.moderation_action as enum (
  'none',
  'hide_lesson',
  'hide_review',
  'suspend_user'
);

alter table public.reports
  add column moderation_action public.moderation_action;

create unique index reports_one_open_target_idx
on public.reports (reporter_id, target_type, target_id)
where status in ('submitted', 'reviewing');

create unique index report_resolution_notification_once_idx
on public.notifications (user_id, ((data ->> 'reportId')))
where type = 'report.resolved'::public.notification_type;

create or replace function public.users_have_block(
  checked_left_user_id uuid,
  checked_right_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocks
    where (blocker_id = checked_left_user_id and blocked_id = checked_right_user_id)
      or (blocker_id = checked_right_user_id and blocked_id = checked_left_user_id)
  );
$$;

revoke all on function public.users_have_block(uuid, uuid) from public, anon, authenticated;

create or replace function public.users_have_commerce_relationship(
  checked_left_user_id uuid,
  checked_right_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reservations
    join public.coach_profiles on coach_profiles.id = reservations.coach_profile_id
    where (
      reservations.learner_id = checked_left_user_id
      and coach_profiles.user_id = checked_right_user_id
    ) or (
      reservations.learner_id = checked_right_user_id
      and coach_profiles.user_id = checked_left_user_id
    )
  );
$$;

revoke all on function public.users_have_commerce_relationship(uuid, uuid)
from public, anon, authenticated;

create or replace function public.report_target_user_id(
  checked_target_type public.report_target_type,
  checked_target_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  case checked_target_type
    when 'user' then
      select profiles.id into target_user_id
      from public.profiles
      where profiles.id = checked_target_id
        and profiles.deleted_at is null
        and profiles.status not in ('suspended', 'deleted');
    when 'coach' then
      select coach_profiles.user_id into target_user_id
      from public.coach_profiles
      join public.profiles on profiles.id = coach_profiles.user_id
      where coach_profiles.id = checked_target_id
        and coach_profiles.status = 'approved'
        and profiles.status = 'coach_approved'
        and profiles.deleted_at is null;
    when 'lesson' then
      select coach_profiles.user_id into target_user_id
      from public.lessons
      join public.coach_profiles on coach_profiles.id = lessons.coach_profile_id
      join public.profiles on profiles.id = coach_profiles.user_id
      where lessons.id = checked_target_id
        and lessons.status = 'active'
        and coach_profiles.status = 'approved'
        and profiles.status = 'coach_approved'
        and profiles.deleted_at is null;
    when 'review' then
      select reviews.reviewer_id into target_user_id
      from public.reviews
      where reviews.id = checked_target_id
        and reviews.status = 'visible';
    when 'reservation' then
      select reservations.learner_id into target_user_id
      from public.reservations
      where reservations.id = checked_target_id;
  end case;

  return target_user_id;
end;
$$;

revoke all on function public.report_target_user_id(public.report_target_type, uuid)
from public, anon, authenticated;

create or replace function public.can_report_target(
  checked_reporter_id uuid,
  checked_target_type public.report_target_type,
  checked_target_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  target_user_id := public.report_target_user_id(checked_target_type, checked_target_id);

  if target_user_id is null
    or (
      checked_target_type <> 'reservation'
      and target_user_id = checked_reporter_id
    ) then
    return false;
  end if;

  case checked_target_type
    when 'user', 'coach' then
      return public.users_have_commerce_relationship(checked_reporter_id, target_user_id);
    when 'lesson', 'review' then
      return true;
    when 'reservation' then
      return exists (
        select 1
        from public.reservations
        join public.coach_profiles on coach_profiles.id = reservations.coach_profile_id
        where reservations.id = checked_target_id
          and (
            reservations.learner_id = checked_reporter_id
            or coach_profiles.user_id = checked_reporter_id
          )
      );
  end case;
end;
$$;

revoke all on function public.can_report_target(uuid, public.report_target_type, uuid)
from public, anon, authenticated;

create or replace function public.create_report(
  checked_target_type public.report_target_type,
  checked_target_id uuid,
  checked_reason text,
  checked_detail text default null
)
returns setof public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  created_report public.reports%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if public.current_user_role() not in ('learner', 'coach') then
    raise exception 'Active user account required.' using errcode = '42501';
  end if;

  if checked_target_id is null
    or checked_reason is null
    or char_length(public.js_trim(checked_reason)) not between 1 and 100
    or (
      checked_detail is not null
      and char_length(public.js_trim(checked_detail)) not between 1 and 1000
    ) then
    raise exception 'Invalid report request.' using errcode = '22023';
  end if;

  if not public.can_report_target(actor_id, checked_target_type, checked_target_id) then
    raise exception 'Report target is unavailable.' using errcode = '42501';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, reason, detail)
  values (
    actor_id,
    checked_target_type,
    checked_target_id,
    public.js_trim(checked_reason),
    case when checked_detail is null then null else public.js_trim(checked_detail) end
  )
  returning * into created_report;

  return next created_report;
end;
$$;

revoke all on function public.create_report(public.report_target_type, uuid, text, text)
from public, anon;
grant execute on function public.create_report(public.report_target_type, uuid, text, text)
to authenticated;

create or replace function public.create_block(
  checked_blocked_id uuid,
  checked_reason text default null
)
returns table (
  block_id uuid,
  blocked_id uuid,
  reason text,
  created_at timestamptz,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  selected_block public.blocks%rowtype;
begin
  if actor_id is null or public.current_user_role() not in ('learner', 'coach') then
    raise exception 'Active user account required.' using errcode = '42501';
  end if;

  if checked_blocked_id is null or checked_blocked_id = actor_id then
    raise exception 'Users cannot block themselves.' using errcode = '22023';
  end if;

  if checked_reason is not null
    and char_length(public.js_trim(checked_reason)) not between 1 and 200 then
    raise exception 'Invalid block reason.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles
    where profiles.id = checked_blocked_id
      and profiles.deleted_at is null
      and profiles.status not in ('suspended', 'deleted')
  ) or not public.users_have_commerce_relationship(actor_id, checked_blocked_id) then
    raise exception 'Block target is unavailable.' using errcode = '42501';
  end if;

  select * into selected_block
  from public.blocks
  where blocker_id = actor_id and blocks.blocked_id = checked_blocked_id;

  if found then
    return query select selected_block.id, selected_block.blocked_id, selected_block.reason,
      selected_block.created_at, true;
    return;
  end if;

  insert into public.blocks (blocker_id, blocked_id, reason)
  values (
    actor_id,
    checked_blocked_id,
    case when checked_reason is null then null else public.js_trim(checked_reason) end
  )
  returning * into selected_block;

  return query select selected_block.id, selected_block.blocked_id, selected_block.reason,
    selected_block.created_at, false;
exception when unique_violation then
  select * into selected_block
  from public.blocks
  where blocker_id = actor_id and blocks.blocked_id = checked_blocked_id;
  return query select selected_block.id, selected_block.blocked_id, selected_block.reason,
    selected_block.created_at, true;
end;
$$;

revoke all on function public.create_block(uuid, text) from public, anon;
grant execute on function public.create_block(uuid, text) to authenticated;

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
          (old.status = 'pending_review' and new.status in ('active', 'rejected'))
          or (
            old.status = 'active'
            and new.status = 'paused'
            and new.paused_reason = 'moderation'
          )
        )
      )
    ) then
    raise exception 'Lesson status transition is not allowed.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.resolve_report(
  checked_report_id uuid,
  checked_action public.report_status_action,
  checked_moderation_action public.moderation_action,
  checked_resolution_note text default null
)
returns table (
  report_id uuid,
  report_status public.report_status,
  moderation_action public.moderation_action,
  reviewed_at timestamptz,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  selected_report public.reports%rowtype;
  next_status public.report_status;
  target_user_id uuid;
  normalized_note text;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Active administrator required.' using errcode = '42501';
  end if;

  if checked_report_id is null or checked_moderation_action is null then
    raise exception 'Invalid report resolution.' using errcode = '22023';
  end if;

  normalized_note := case
    when checked_resolution_note is null then null
    else public.js_trim(checked_resolution_note)
  end;

  if normalized_note is not null and char_length(normalized_note) not between 1 and 1000 then
    raise exception 'Invalid resolution note.' using errcode = '22023';
  end if;

  select * into selected_report
  from public.reports
  where reports.id = checked_report_id
  for update;

  if not found then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;

  case checked_action
    when 'start_review' then
      next_status := 'reviewing';
      if checked_moderation_action <> 'none' or normalized_note is not null then
        raise exception 'Review start cannot apply moderation.' using errcode = '22023';
      end if;
    when 'resolve' then
      next_status := 'resolved';
      if normalized_note is null then
        raise exception 'Resolution note is required.' using errcode = '22023';
      end if;
    when 'reject' then
      next_status := 'rejected';
      if checked_moderation_action <> 'none' or normalized_note is null then
        raise exception 'Rejected reports require a note and no moderation effect.'
          using errcode = '22023';
      end if;
  end case;

  if selected_report.status = next_status
    and coalesce(selected_report.moderation_action, 'none') = checked_moderation_action
    and selected_report.resolution_note is not distinct from normalized_note then
    return query select selected_report.id, selected_report.status,
      coalesce(selected_report.moderation_action, 'none'::public.moderation_action),
      selected_report.reviewed_at, true;
    return;
  end if;

  if (checked_action = 'start_review' and selected_report.status <> 'submitted')
    or (checked_action in ('resolve', 'reject') and selected_report.status <> 'reviewing') then
    raise exception 'Report review state has changed.' using errcode = 'P0001';
  end if;

  if checked_action = 'resolve' then
    case checked_moderation_action
      when 'none' then
        null;
      when 'hide_lesson' then
        if selected_report.target_type <> 'lesson' then
          raise exception 'Moderation action does not match report target.' using errcode = '22023';
        end if;
        update public.lessons
        set status = 'paused', paused_reason = 'moderation'
        where id = selected_report.target_id and status = 'active';
        if not found then
          raise exception 'Moderation target is unavailable.' using errcode = 'P0002';
        end if;
      when 'hide_review' then
        if selected_report.target_type <> 'review' then
          raise exception 'Moderation action does not match report target.' using errcode = '22023';
        end if;
        update public.reviews
        set status = 'hidden', hidden_reason = 'moderation'
        where id = selected_report.target_id and status = 'visible';
        if not found then
          raise exception 'Moderation target is unavailable.' using errcode = 'P0002';
        end if;
      when 'suspend_user' then
        if selected_report.target_type not in ('user', 'coach') then
          raise exception 'Moderation action does not match report target.' using errcode = '22023';
        end if;
        target_user_id := public.report_target_user_id(
          selected_report.target_type,
          selected_report.target_id
        );
        update public.profiles
        set status = 'suspended'
        where id = target_user_id and status not in ('suspended', 'deleted');
        if not found then
          raise exception 'Moderation target is unavailable.' using errcode = 'P0002';
        end if;
    end case;
  end if;

  update public.reports
  set
    status = next_status,
    moderation_action = checked_moderation_action,
    reviewed_by = actor_id,
    reviewed_at = statement_timestamp(),
    resolution_note = normalized_note
  where id = selected_report.id
  returning * into selected_report;

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, before_data, after_data
  ) values (
    actor_id,
    'report.' || checked_action::text,
    'report',
    selected_report.id,
    jsonb_build_object('status', case checked_action when 'start_review' then 'submitted' else 'reviewing' end),
    jsonb_build_object(
      'status', selected_report.status,
      'moderationAction', checked_moderation_action
    )
  );

  if next_status in ('resolved', 'rejected') then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      selected_report.reporter_id,
      'report.resolved',
      '신고 처리 결과가 등록되었습니다',
      null,
      jsonb_build_object('reportId', selected_report.id, 'status', next_status)
    );
  end if;

  return query select selected_report.id, selected_report.status,
    selected_report.moderation_action, selected_report.reviewed_at, false;
end;
$$;

revoke all on function public.resolve_report(
  uuid, public.report_status_action, public.moderation_action, text
) from public, anon;
grant execute on function public.resolve_report(
  uuid, public.report_status_action, public.moderation_action, text
) to authenticated;

create or replace function public.lesson_is_public(checked_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons
    join public.coach_profiles on coach_profiles.id = lessons.coach_profile_id
    join public.profiles on profiles.id = coach_profiles.user_id
    where lessons.id = checked_lesson_id
      and lessons.status = 'active'
      and coach_profiles.status = 'approved'
      and profiles.status = 'coach_approved'
      and profiles.deleted_at is null
      and (
        auth.uid() is null
        or not public.users_have_block(auth.uid(), coach_profiles.user_id)
      )
  );
$$;

create or replace function public.create_pending_reservation(
  checked_lesson_id uuid,
  checked_schedule_id uuid
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_lesson public.lessons%rowtype;
  selected_schedule public.lesson_schedules%rowtype;
  selected_coach_user_id uuid;
  confirmed_reservation_count integer;
  active_pending_count integer;
  created_reservation public.reservations%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'learner' then
    raise exception 'Learner account required.' using errcode = '42501';
  end if;

  select lessons.*
  into selected_lesson
  from public.lessons
  where lessons.id = checked_lesson_id
    and public.lesson_is_public(lessons.id);

  if not found then
    raise exception 'Lesson not found.' using errcode = 'P0002';
  end if;

  select coach_profiles.user_id into selected_coach_user_id
  from public.coach_profiles
  where coach_profiles.id = selected_lesson.coach_profile_id;

  if public.users_have_block(auth.uid(), selected_coach_user_id) then
    raise exception 'Blocked users cannot create a new reservation.' using errcode = '42501';
  end if;

  select * into selected_schedule
  from public.lesson_schedules
  where id = checked_schedule_id and lesson_id = checked_lesson_id
  for update;

  if not found or not selected_schedule.is_open or selected_schedule.starts_at <= now() then
    raise exception 'Schedule is not available.' using errcode = 'P0001';
  end if;

  select count(*)::integer into confirmed_reservation_count
  from public.reservations
  where learner_id = auth.uid()
    and lesson_schedule_id = checked_schedule_id
    and status = 'confirmed';

  if confirmed_reservation_count > 0 then
    raise exception 'Confirmed reservation already exists.' using errcode = '23505';
  end if;

  select * into created_reservation
  from public.reservations
  where learner_id = auth.uid()
    and lesson_schedule_id = checked_schedule_id
    and status = 'pending_payment'
    and payment_expires_at > now()
  order by created_at desc
  limit 1;

  if found then
    return created_reservation;
  end if;

  select count(*)::integer into active_pending_count
  from public.reservations
  where lesson_schedule_id = checked_schedule_id
    and status = 'pending_payment'
    and payment_expires_at > now();

  if selected_schedule.reserved_count + active_pending_count >= selected_schedule.capacity then
    raise exception 'Schedule capacity exceeded.' using errcode = 'P0003';
  end if;

  insert into public.reservations (
    lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
    status, reserved_price_amount, payment_expires_at
  ) values (
    selected_lesson.id, selected_schedule.id, auth.uid(), selected_lesson.coach_profile_id,
    'pending_payment', selected_lesson.price_amount, now() + interval '10 minutes'
  ) returning * into created_reservation;

  return created_reservation;
end;
$$;

revoke all on function public.create_pending_reservation(uuid, uuid) from public;
grant execute on function public.create_pending_reservation(uuid, uuid) to authenticated;
