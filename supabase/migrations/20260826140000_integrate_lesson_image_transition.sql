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
    if checked_action = 'submit' and (
      exists (
        select 1 from public.lesson_image_upload_intents
        where lesson_id = selected_lesson.id
          and (
            status = 'claimed'
            or (status = 'pending' and expires_at > statement_timestamp())
          )
      )
      or exists (
        select 1 from public.lesson_images
        where lesson_id = selected_lesson.id and lifecycle_state = 'deleting'
      )
    ) then
      raise exception 'IMAGE_OPERATION_PENDING' using errcode = 'P0001';
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
    actor_id, action, target_type, target_id, before_data, after_data
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
