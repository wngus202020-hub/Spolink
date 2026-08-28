drop function if exists public.register_lesson_image(uuid, text);

create or replace function public.register_validated_lesson_image(
  checked_actor_id uuid,
  checked_intent_id uuid,
  checked_object_name text
)
returns setof public.lesson_images
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  selected_intent public.lesson_image_upload_intents;
  created_image public.lesson_images;
  object_metadata jsonb;
begin
  select coach_profiles.id
  into selected_coach_profile_id
  from public.coach_profiles
  join public.profiles on profiles.id = coach_profiles.user_id
  where coach_profiles.user_id = checked_actor_id
    and coach_profiles.status = 'approved'
    and profiles.status = 'coach_approved'
    and profiles.deleted_at is null;

  if selected_coach_profile_id is null then
    raise exception 'COACH_NOT_APPROVED' using errcode = 'P0001';
  end if;

  select * into selected_intent
  from public.lesson_image_upload_intents
  where id = checked_intent_id;
  if not found
    or selected_intent.user_id <> checked_actor_id
    or selected_intent.coach_profile_id <> selected_coach_profile_id
    or selected_intent.object_name <> checked_object_name then
    raise exception 'IMAGE_INTENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into selected_lesson
  from public.lessons
  where id = selected_intent.lesson_id
  for update;

  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into selected_intent
  from public.lesson_image_upload_intents
  where id = checked_intent_id
  for update;
  if not found
    or selected_intent.user_id <> checked_actor_id
    or selected_intent.coach_profile_id <> selected_coach_profile_id
    or selected_intent.object_name <> checked_object_name then
    raise exception 'IMAGE_INTENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;
  if selected_intent.status = 'registered' then
    select * into created_image
    from public.lesson_images
    where id = selected_intent.registered_image_id
      and lesson_id = selected_intent.lesson_id
      and file_path = selected_intent.object_name
      and lifecycle_state = 'ready';
    if not found then
      raise exception 'IMAGE_INTENT_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    return next created_image;
    return;
  end if;
  if selected_intent.status <> 'pending'
    or selected_intent.expires_at <= statement_timestamp() then
    raise exception 'IMAGE_INTENT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.lesson_images
    where lesson_id = selected_lesson.id and lifecycle_state = 'deleting'
  ) then
    raise exception 'IMAGE_OPERATION_PENDING' using errcode = 'P0001';
  end if;

  select objects.metadata into object_metadata
  from storage.objects
  where objects.bucket_id = 'lesson-images'
    and objects.name = selected_intent.object_name;
  if not found then
    raise exception 'IMAGE_OBJECT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if coalesce(object_metadata ->> 'mimetype', '') <> selected_intent.mime_type
    or not (object_metadata ? 'size')
    or (object_metadata ->> 'size') !~ '^[0-9]+$'
    or (object_metadata ->> 'size')::bigint <> selected_intent.size_bytes then
    raise exception 'IMAGE_OBJECT_INVALID' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.lesson_images
    where lesson_id = selected_lesson.id and lifecycle_state = 'ready'
  ) >= 5 then
    raise exception 'LESSON_IMAGE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.lesson_images (lesson_id, file_path, sort_order, lifecycle_state)
  select selected_lesson.id,
         selected_intent.object_name,
         count(*)::integer,
         'ready'
  from public.lesson_images
  where lesson_id = selected_lesson.id and lifecycle_state = 'ready'
  returning * into created_image;

  update public.lesson_image_upload_intents
  set status = 'registered',
      registered_image_id = created_image.id,
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = selected_intent.id;

  return next created_image;
end;
$$;

revoke execute on function public.register_validated_lesson_image(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_validated_lesson_image(uuid, uuid, text)
  to service_role;
