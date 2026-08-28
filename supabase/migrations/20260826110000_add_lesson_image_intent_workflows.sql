create or replace function public.create_lesson_image_upload_intent(
  checked_lesson_id uuid,
  checked_mime_type text,
  checked_size_bytes bigint
)
returns setof public.lesson_image_upload_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  created_intent public.lesson_image_upload_intents;
  object_id uuid := gen_random_uuid();
  object_extension text;
begin
  selected_coach_profile_id := public.require_approved_coach();

  select * into selected_lesson
  from public.lessons
  where id = checked_lesson_id
  for update;

  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;

  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;
  if checked_size_bytes is null or checked_size_bytes not between 1 and 5242880 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  object_extension := case checked_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if object_extension is null then
    raise exception 'UNSUPPORTED_IMAGE_TYPE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.lesson_images
    where lesson_id = checked_lesson_id and lifecycle_state = 'deleting'
  ) then
    raise exception 'IMAGE_OPERATION_PENDING' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.lesson_images
    where lesson_id = checked_lesson_id and lifecycle_state = 'ready'
  ) + (
    select count(*) from public.lesson_image_upload_intents
    where lesson_id = checked_lesson_id
      and status = 'pending'
      and expires_at > statement_timestamp()
  ) >= 5 then
    raise exception 'LESSON_IMAGE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.lesson_image_upload_intents (
    lesson_id, coach_profile_id, user_id, object_name, mime_type, size_bytes
  ) values (
    selected_lesson.id,
    selected_coach_profile_id,
    (select auth.uid()),
    selected_lesson.id::text || '/' || object_id::text || '.' || object_extension,
    checked_mime_type,
    checked_size_bytes
  ) returning * into created_intent;

  return next created_intent;
end;
$$;

create or replace function public.cancel_lesson_image_upload_intent(
  checked_lesson_id uuid,
  checked_intent_id uuid,
  checked_object_name text
)
returns setof public.lesson_image_upload_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  selected_intent public.lesson_image_upload_intents;
begin
  selected_coach_profile_id := public.require_approved_coach();

  select * into selected_lesson
  from public.lessons
  where id = checked_lesson_id
  for update;

  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  select * into selected_intent
  from public.lesson_image_upload_intents
  where id = checked_intent_id
    and lesson_id = checked_lesson_id
    and coach_profile_id = selected_coach_profile_id
    and user_id = (select auth.uid())
    and object_name = checked_object_name
  for update;

  if not found then
    raise exception 'IMAGE_INTENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_intent.status = 'cancelled' then
    return next selected_intent;
    return;
  end if;
  if selected_intent.status <> 'pending' then
    raise exception 'IMAGE_INTENT_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  update public.lesson_image_upload_intents
  set status = 'cancelled',
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = selected_intent.id
  returning * into selected_intent;

  return next selected_intent;
end;
$$;
