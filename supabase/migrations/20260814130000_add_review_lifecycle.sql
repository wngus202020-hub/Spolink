create unique index if not exists reviews_one_reservation_idx
on public.reviews (reservation_id);

create or replace function public.protect_review_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_setting('app.review_workflow', true) = 'hide' then
    return new;
  end if;
  if old.status is distinct from new.status
    or old.hidden_reason is distinct from new.hidden_reason
    or old.reviewer_id is distinct from new.reviewer_id
    or old.reservation_id is distinct from new.reservation_id
    or old.lesson_id is distinct from new.lesson_id
    or old.coach_profile_id is distinct from new.coach_profile_id then
    raise exception 'Review system fields are workflow-owned.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_protect_system_fields on public.reviews;
create trigger reviews_protect_system_fields
before update on public.reviews
for each row execute function public.protect_review_system_fields();

create or replace function public.create_review(
  checked_reservation_id uuid,
  checked_rating integer,
  checked_content text
)
returns table (
  review_id uuid,
  reservation_id uuid,
  lesson_id uuid,
  rating integer,
  content text,
  created_at timestamptz,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  selected_reservation public.reservations%rowtype;
  selected_payment public.payments%rowtype;
  selected_review public.reviews%rowtype;
  selected_coach_user_id uuid;
  normalized_content text;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if checked_rating is null or checked_rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5.' using errcode = '22023';
  end if;
  normalized_content := public.js_trim(checked_content);
  if normalized_content is null or char_length(normalized_content) not between 1 and 2000 then
    raise exception 'Review content must be 1 to 2000 characters.' using errcode = '22023';
  end if;

  select * into selected_reservation
  from public.reservations
  where id = checked_reservation_id
  for update;
  if not found then raise exception 'Reservation not found.' using errcode = 'P0002'; end if;
  if selected_reservation.learner_id <> actor_id then
    raise exception 'Only the reservation learner can review.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = actor_id and role = 'learner' and status = 'active' and deleted_at is null
  ) then
    raise exception 'Active learner profile required.' using errcode = '42501';
  end if;
  if selected_reservation.status <> 'completed' then
    raise exception 'Only completed reservations can be reviewed.' using errcode = 'P0001';
  end if;

  select user_id into selected_coach_user_id
  from public.coach_profiles where id = selected_reservation.coach_profile_id;
  if selected_coach_user_id = actor_id then
    raise exception 'A coach cannot review their own lesson.' using errcode = '42501';
  end if;

  select * into selected_payment from public.payments
  where public.payments.reservation_id = checked_reservation_id
  order by created_at desc limit 1;
  if found and selected_payment.status in ('refunded', 'partially_refunded') then
    raise exception 'Refunded reservations cannot be reviewed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.refunds where public.refunds.reservation_id = checked_reservation_id and status = 'completed') then
    raise exception 'Refunded reservations cannot be reviewed.' using errcode = 'P0001';
  end if;

  insert into public.reviews (
    reservation_id, lesson_id, coach_profile_id, reviewer_id, status, rating, content
  ) values (
    selected_reservation.id, selected_reservation.lesson_id, selected_reservation.coach_profile_id,
    actor_id, 'visible', checked_rating, normalized_content
  ) returning * into selected_review;

  return query select selected_review.id, selected_review.reservation_id, selected_review.lesson_id,
    selected_review.rating, selected_review.content, selected_review.created_at, false;
exception when unique_violation then
  raise exception 'A review already exists for this reservation.' using errcode = '23505';
end;
$$;

create or replace function public.hide_review(
  checked_review_id uuid,
  checked_reason text default 'moderation'
)
returns table (review_id uuid, status public.review_status, hidden_reason text, idempotent boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  selected_review public.reviews%rowtype;
  normalized_reason text := public.js_trim(checked_reason);
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Active administrator required.' using errcode = '42501';
  end if;
  if normalized_reason is null or char_length(normalized_reason) not between 1 and 200 then
    raise exception 'Hide reason must be 1 to 200 characters.' using errcode = '22023';
  end if;
  select * into selected_review from public.reviews where id = checked_review_id for update;
  if not found then raise exception 'Review not found.' using errcode = 'P0002'; end if;
  if selected_review.status = 'hidden' and selected_review.hidden_reason = normalized_reason then
    return query select selected_review.id, selected_review.status, selected_review.hidden_reason, true;
    return;
  end if;
  if selected_review.status <> 'visible' then
    raise exception 'Review state has changed.' using errcode = 'P0001';
  end if;
  perform set_config('app.review_workflow', 'hide', true);
  update public.reviews set status = 'hidden', hidden_reason = normalized_reason
  where id = selected_review.id returning * into selected_review;
  insert into public.audit_logs (actor_id, action, target_type, target_id, before_data, after_data)
  values (actor_id, 'review.hidden', 'review', selected_review.id,
    jsonb_build_object('status', 'visible'),
    jsonb_build_object('status', 'hidden', 'reason', normalized_reason));
  return query select selected_review.id, selected_review.status, selected_review.hidden_reason, false;
end;
$$;

revoke all on table public.reviews from public, anon, authenticated;
grant select on table public.reviews to anon, authenticated;
drop policy if exists "reviews_public_visible_select" on public.reviews;
drop policy if exists "reviews_insert_reviewer" on public.reviews;
drop policy if exists "reviews_update_admin" on public.reviews;
drop policy if exists "reviews_public_visible_only" on public.reviews;
create policy "reviews_public_visible_only" on public.reviews
  for select to anon, authenticated using (status = 'visible');

revoke insert, update, delete on table public.reviews from public, anon, authenticated;
revoke all on function public.create_review(uuid, integer, text) from public, anon;
grant execute on function public.create_review(uuid, integer, text) to authenticated;
revoke all on function public.hide_review(uuid, text) from public, anon;
grant execute on function public.hide_review(uuid, text) to authenticated;
revoke all on function public.protect_review_system_fields() from public, anon, authenticated;
