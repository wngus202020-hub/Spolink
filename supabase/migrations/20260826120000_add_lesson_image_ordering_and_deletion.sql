create or replace function public.reorder_lesson_images(
  checked_lesson_id uuid,
  checked_expected_image_ids uuid[],
  checked_ordered_image_ids uuid[]
)
returns setof public.lesson_images
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  current_image_ids uuid[];
begin
  selected_coach_profile_id := public.require_approved_coach();
  select * into selected_lesson from public.lessons where id = checked_lesson_id for update;
  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id order by sort_order, id), array[]::uuid[])
  into current_image_ids
  from public.lesson_images
  where lesson_id = checked_lesson_id and lifecycle_state = 'ready';

  if checked_expected_image_ids is null
    or checked_ordered_image_ids is null
    or checked_expected_image_ids <> current_image_ids
    or cardinality(checked_ordered_image_ids) <> cardinality(current_image_ids)
    or exists (select 1 from unnest(checked_ordered_image_ids) item where item is null)
    or (select count(distinct item) from unnest(checked_ordered_image_ids) item)
      <> cardinality(current_image_ids)
    or (select array_agg(item order by item) from unnest(checked_ordered_image_ids) item)
      is distinct from (select array_agg(item order by item) from unnest(current_image_ids) item)
  then
    raise exception 'STALE_LESSON_IMAGES' using errcode = 'P0001';
  end if;

  set constraints lesson_images_lesson_sort_key deferred;
  update public.lesson_images image
  set sort_order = ordered.ordinality - 1
  from unnest(checked_ordered_image_ids) with ordinality ordered(id, ordinality)
  where image.id = ordered.id and image.lesson_id = checked_lesson_id;

  return query
  select * from public.lesson_images
  where lesson_id = checked_lesson_id and lifecycle_state = 'ready'
  order by sort_order, id;
end;
$$;

create or replace function public.begin_delete_lesson_image(
  checked_lesson_id uuid,
  checked_image_id uuid,
  checked_expected_image_ids uuid[]
)
returns table(file_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  selected_image public.lesson_images;
  selected_receipt public.lesson_image_deletion_receipts;
  current_image_ids uuid[];
begin
  selected_coach_profile_id := public.require_approved_coach();
  select * into selected_lesson from public.lessons where id = checked_lesson_id for update;
  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  select * into selected_image
  from public.lesson_images
  where id = checked_image_id and lesson_id = checked_lesson_id;
  if not found then
    select * into selected_receipt
    from public.lesson_image_deletion_receipts
    where lesson_id = checked_lesson_id
      and image_id = checked_image_id
      and coach_profile_id = selected_coach_profile_id
      and user_id = (select auth.uid());
    if not found then
      raise exception 'LESSON_IMAGE_NOT_FOUND' using errcode = 'P0001';
    end if;
    file_path := selected_receipt.file_path;
    return next;
    return;
  end if;
  if selected_image.lifecycle_state = 'deleting' then
    file_path := selected_image.file_path;
    return next;
    return;
  end if;

  select coalesce(array_agg(id order by sort_order, id), array[]::uuid[])
  into current_image_ids
  from public.lesson_images
  where lesson_id = checked_lesson_id and lifecycle_state = 'ready';
  if checked_expected_image_ids is null or checked_expected_image_ids <> current_image_ids then
    raise exception 'STALE_LESSON_IMAGES' using errcode = 'P0001';
  end if;

  update public.lesson_images set lifecycle_state = 'deleting' where id = checked_image_id;
  set constraints lesson_images_lesson_sort_key deferred;
  with ordered as (
    select id, row_number() over (
      order by (lifecycle_state = 'deleting'), sort_order, id
    ) - 1 as next_sort
    from public.lesson_images where lesson_id = checked_lesson_id
  )
  update public.lesson_images image
  set sort_order = ordered.next_sort
  from ordered where image.id = ordered.id;

  select * into selected_image from public.lesson_images where id = checked_image_id;
  file_path := selected_image.file_path;
  return next;
end;
$$;

create or replace function public.finalize_delete_lesson_image(
  checked_lesson_id uuid,
  checked_image_id uuid
)
returns setof public.lesson_images
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_coach_profile_id uuid;
  selected_lesson public.lessons;
  selected_image public.lesson_images;
  selected_receipt public.lesson_image_deletion_receipts;
begin
  selected_coach_profile_id := public.require_approved_coach();
  select * into selected_lesson from public.lessons where id = checked_lesson_id for update;
  if not found or selected_lesson.coach_profile_id <> selected_coach_profile_id then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if selected_lesson.status not in ('draft', 'rejected') then
    raise exception 'LESSON_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  select * into selected_image
  from public.lesson_images
  where id = checked_image_id and lesson_id = checked_lesson_id;
  if found and selected_image.lifecycle_state <> 'deleting' then
    raise exception 'LESSON_IMAGE_NOT_DELETING' using errcode = 'P0001';
  end if;
  if found then
    insert into public.lesson_image_deletion_receipts (
      lesson_id, image_id, coach_profile_id, user_id, file_path
    ) values (
      checked_lesson_id,
      checked_image_id,
      selected_coach_profile_id,
      (select auth.uid()),
      selected_image.file_path
    );
    delete from public.lesson_images where id = checked_image_id;
  else
    select * into selected_receipt
    from public.lesson_image_deletion_receipts
    where lesson_id = checked_lesson_id
      and image_id = checked_image_id
      and coach_profile_id = selected_coach_profile_id
      and user_id = (select auth.uid());
    if not found then
      raise exception 'LESSON_IMAGE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  set constraints lesson_images_lesson_sort_key deferred;
  with ordered as (
    select id, row_number() over (
      order by (lifecycle_state = 'deleting'), sort_order, id
    ) - 1 as next_sort
    from public.lesson_images where lesson_id = checked_lesson_id
  )
  update public.lesson_images image
  set sort_order = ordered.next_sort
  from ordered where image.id = ordered.id;

  return query
  select * from public.lesson_images
  where lesson_id = checked_lesson_id and lifecycle_state = 'ready'
  order by sort_order, id;
end;
$$;
