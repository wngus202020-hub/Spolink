create extension if not exists pgcrypto;

create type public.user_status as enum ('active', 'pending_coach', 'coach_approved', 'suspended', 'deleted');
create type public.user_role as enum ('learner', 'coach', 'admin');
create type public.coach_status as enum ('draft', 'submitted', 'approved', 'rejected', 'suspended');
create type public.lesson_status as enum ('draft', 'pending_review', 'active', 'paused', 'closed', 'rejected');
create type public.reservation_status as enum (
  'pending_payment',
  'confirmed',
  'cancelled_by_user',
  'cancelled_by_coach',
  'cancelled_by_admin',
  'completed',
  'no_show_user',
  'no_show_coach',
  'disputed'
);
create type public.payment_status as enum (
  'ready',
  'paid',
  'failed',
  'cancelled',
  'partially_refunded',
  'refunded'
);
create type public.settlement_status as enum ('pending', 'hold', 'approved', 'paid', 'failed');
create type public.review_status as enum ('visible', 'hidden', 'deleted');
create type public.report_status as enum ('submitted', 'reviewing', 'resolved', 'rejected');
create type public.refund_status as enum ('requested', 'approved', 'failed', 'completed');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'learner',
  status public.user_status not null default 'active',
  display_name text not null,
  real_name text,
  phone text,
  avatar_path text,
  default_region text,
  marketing_agreed_at timestamptz,
  location_agreed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coach_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  status public.coach_status not null default 'draft',
  headline text,
  bio text,
  primary_sport_id uuid references public.sports(id) on delete set null,
  service_region text not null,
  career_years integer not null default 0 check (career_years >= 0),
  intro_video_url text,
  bank_name text,
  bank_account_last4 text check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$'),
  payout_holder_name text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coach_certificates (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles(id) on delete cascade,
  certificate_name text not null,
  issuer text,
  certificate_number text,
  file_path text not null,
  verified_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create view public.coach_profile_public_cards as
select
  id,
  headline,
  bio,
  primary_sport_id,
  service_region,
  career_years,
  intro_video_url,
  created_at,
  updated_at
from public.coach_profiles
where status = 'approved';

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  coach_profile_id uuid not null references public.coach_profiles(id) on delete restrict,
  sport_id uuid not null references public.sports(id) on delete restrict,
  status public.lesson_status not null default 'draft',
  title text not null,
  summary text,
  description text not null,
  region text not null,
  address text,
  place_name text,
  latitude numeric,
  longitude numeric,
  duration_minutes integer not null check (duration_minutes > 0),
  price_amount integer not null check (price_amount >= 0),
  capacity integer not null default 1 check (capacity > 0),
  preparation text,
  cancellation_policy_summary text,
  paused_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lesson_images (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  file_path text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create table public.lesson_schedules (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_schedules_time_order check (ends_at > starts_at),
  constraint lesson_schedules_reserved_capacity check (reserved_count <= capacity)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete restrict,
  lesson_schedule_id uuid not null references public.lesson_schedules(id) on delete restrict,
  learner_id uuid not null references public.profiles(id) on delete restrict,
  coach_profile_id uuid not null references public.coach_profiles(id) on delete restrict,
  status public.reservation_status not null default 'pending_payment',
  reserved_price_amount integer not null check (reserved_price_amount >= 0),
  payment_expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  completed_at timestamptz,
  no_show_marked_at timestamptz,
  dispute_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_pending_payment_expires check (
    status <> 'pending_payment' or payment_expires_at is not null
  )
);

create unique index reservations_one_confirmed_per_learner_schedule
  on public.reservations (learner_id, lesson_schedule_id)
  where status = 'confirmed';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete restrict,
  payer_id uuid not null references public.profiles(id) on delete restrict,
  status public.payment_status not null default 'ready',
  provider text not null default 'toss',
  provider_payment_key text unique,
  provider_order_id text not null unique,
  amount integer not null check (amount >= 0),
  approved_at timestamptz,
  failed_reason text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  amount integer not null check (amount >= 0),
  reason text not null,
  source text not null default 'manual' check (
    source in ('manual', 'reservation_cancellation', 'payment_confirmation_reconciliation')
  ),
  provider_refund_key text,
  status public.refund_status not null default 'requested',
  processed_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete restrict,
  coach_profile_id uuid not null references public.coach_profiles(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  status public.settlement_status not null default 'pending',
  gross_amount integer not null check (gross_amount >= 0),
  platform_fee_amount integer not null default 0 check (platform_fee_amount >= 0),
  payment_fee_amount integer not null default 0 check (payment_fee_amount >= 0),
  refund_amount integer not null default 0 check (refund_amount >= 0),
  net_amount integer not null check (net_amount >= 0),
  hold_reason text,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete restrict,
  lesson_id uuid not null references public.lessons(id) on delete restrict,
  coach_profile_id uuid not null references public.coach_profiles(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  status public.review_status not null default 'visible',
  rating integer not null check (rating between 1 and 5),
  content text,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lesson_favorites (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (learner_id, lesson_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (
    target_type in ('user', 'coach', 'lesson', 'review', 'reservation', 'message')
  ),
  target_id uuid not null,
  status public.report_status not null default 'submitted',
  reason text not null,
  detail text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  constraint blocks_cannot_self_block check (blocker_id <> blocked_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);
create index profiles_status_idx on public.profiles (status);
create index profiles_default_region_idx on public.profiles (default_region);
create index coach_profiles_user_id_idx on public.coach_profiles (user_id);
create index coach_profiles_status_idx on public.coach_profiles (status);
create index coach_profiles_primary_sport_id_idx on public.coach_profiles (primary_sport_id);
create index coach_profiles_service_region_idx on public.coach_profiles (service_region);
create index coach_certificates_coach_profile_id_idx on public.coach_certificates (coach_profile_id);
create index lessons_coach_profile_id_idx on public.lessons (coach_profile_id);
create index lessons_sport_id_idx on public.lessons (sport_id);
create index lessons_status_idx on public.lessons (status);
create index lessons_region_idx on public.lessons (region);
create index lessons_price_amount_idx on public.lessons (price_amount);
create index lessons_created_at_desc_idx on public.lessons (created_at desc);
create index lesson_images_lesson_sort_idx on public.lesson_images (lesson_id, sort_order);
create index lesson_schedules_lesson_starts_idx on public.lesson_schedules (lesson_id, starts_at);
create index lesson_schedules_starts_at_idx on public.lesson_schedules (starts_at);
create index lesson_schedules_is_open_idx on public.lesson_schedules (is_open);
create index reservations_learner_created_idx on public.reservations (learner_id, created_at desc);
create index reservations_coach_created_idx on public.reservations (coach_profile_id, created_at desc);
create index reservations_lesson_schedule_id_idx on public.reservations (lesson_schedule_id);
create index reservations_status_idx on public.reservations (status);
create index reservations_payment_expires_at_idx on public.reservations (payment_expires_at);
create index payments_reservation_id_idx on public.payments (reservation_id);
create index payments_payer_id_idx on public.payments (payer_id);
create index payments_status_idx on public.payments (status);
create index payments_provider_order_id_idx on public.payments (provider_order_id);
create index payments_provider_payment_key_idx on public.payments (provider_payment_key);
create index refunds_payment_id_idx on public.refunds (payment_id);
create index refunds_reservation_id_idx on public.refunds (reservation_id);
create index refunds_status_idx on public.refunds (status);
create unique index refunds_automatic_reservation_source_unique
  on public.refunds (reservation_id, source)
  where source in ('reservation_cancellation', 'payment_confirmation_reconciliation');
create index settlements_coach_created_idx on public.settlements (coach_profile_id, created_at desc);
create index settlements_status_idx on public.settlements (status);
create index settlements_reservation_id_idx on public.settlements (reservation_id);
create index reviews_lesson_created_idx on public.reviews (lesson_id, created_at desc);
create index reviews_coach_created_idx on public.reviews (coach_profile_id, created_at desc);
create index reviews_reviewer_created_idx on public.reviews (reviewer_id, created_at desc);
create index reviews_status_idx on public.reviews (status);
create index lesson_favorites_learner_created_idx on public.lesson_favorites (learner_id, created_at desc);
create index lesson_favorites_lesson_id_idx on public.lesson_favorites (lesson_id);
create index reports_reporter_created_idx on public.reports (reporter_id, created_at desc);
create index reports_target_idx on public.reports (target_type, target_id);
create index reports_status_idx on public.reports (status);
create index blocks_blocker_id_idx on public.blocks (blocker_id);
create index blocks_blocked_id_idx on public.blocks (blocked_id);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_read_at_idx on public.notifications (read_at);
create index audit_logs_actor_created_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
    and deleted_at is null
    and status not in ('suspended', 'deleted');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.owns_coach_profile(coach_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.coach_profiles
    where id = coach_profile_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.owns_lesson(lesson_id uuid)
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
    where lessons.id = lesson_id
      and coach_profiles.user_id = (select auth.uid())
  );
$$;

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
    where lessons.id = checked_lesson_id
      and lessons.status = 'active'
      and coach_profiles.status = 'approved'
  );
$$;

create or replace function public.can_view_reservation(reservation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reservations
    left join public.coach_profiles on coach_profiles.id = reservations.coach_profile_id
    where reservations.id = reservation_id
      and (
        reservations.learner_id = (select auth.uid())
        or coach_profiles.user_id = (select auth.uid())
        or public.is_admin()
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
  confirmed_reservation_count integer;
  active_pending_count integer;
  created_reservation public.reservations%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'learner' then
    raise exception 'Learner account required.' using errcode = '42501';
  end if;

  select *
    into selected_lesson
    from public.lessons
    where id = checked_lesson_id
      and public.lesson_is_public(id);

  if not found then
    raise exception 'Lesson not found.' using errcode = 'P0002';
  end if;

  select *
    into selected_schedule
    from public.lesson_schedules
    where id = checked_schedule_id
      and lesson_id = checked_lesson_id
    for update;

  if not found
    or not selected_schedule.is_open
    or selected_schedule.starts_at <= now() then
    raise exception 'Schedule is not available.' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into confirmed_reservation_count
    from public.reservations
    where learner_id = auth.uid()
      and lesson_schedule_id = checked_schedule_id
      and status = 'confirmed';

  if confirmed_reservation_count > 0 then
    raise exception 'Confirmed reservation already exists.' using errcode = '23505';
  end if;

  select *
    into created_reservation
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

  select count(*)::integer
    into active_pending_count
    from public.reservations
    where lesson_schedule_id = checked_schedule_id
      and status = 'pending_payment'
      and payment_expires_at > now();

  if selected_schedule.reserved_count + active_pending_count >= selected_schedule.capacity then
    raise exception 'Schedule capacity exceeded.' using errcode = 'P0003';
  end if;

  insert into public.reservations (
    lesson_id,
    lesson_schedule_id,
    learner_id,
    coach_profile_id,
    status,
    reserved_price_amount,
    payment_expires_at
  )
  values (
    selected_lesson.id,
    selected_schedule.id,
    auth.uid(),
    selected_lesson.coach_profile_id,
    'pending_payment',
    selected_lesson.price_amount,
    now() + interval '10 minutes'
  )
returning * into created_reservation;

  return created_reservation;
end;
$$;

revoke all on function public.create_pending_reservation(uuid, uuid) from public;
grant execute on function public.create_pending_reservation(uuid, uuid) to authenticated;

create or replace function public.create_ready_payment(checked_reservation_id uuid)
returns table (
  payment_id uuid,
  provider text,
  provider_order_id text,
  amount integer,
  order_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_reservation public.reservations%rowtype;
  selected_lesson public.lessons%rowtype;
  selected_payment public.payments%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'learner' then
    raise exception 'Learner account required.' using errcode = '42501';
  end if;

  select *
    into selected_reservation
    from public.reservations
    where id = checked_reservation_id
      and learner_id = auth.uid()
    for update;

  if not found then
    raise exception 'Reservation not found.' using errcode = 'P0002';
  end if;

  if selected_reservation.status <> 'pending_payment' then
    raise exception 'Reservation is not pending payment.' using errcode = '23505';
  end if;

  if selected_reservation.payment_expires_at <= now() then
    raise exception 'Reservation expired.' using errcode = 'P0005';
  end if;

  select *
    into selected_lesson
    from public.lessons
    where id = selected_reservation.lesson_id;

  if not found then
    raise exception 'Reservation not found.' using errcode = 'P0002';
  end if;

  select *
    into selected_payment
    from public.payments
    where reservation_id = selected_reservation.id
    for update;

  if found and selected_payment.status <> 'ready' then
    raise exception 'Payment cannot be prepared.' using errcode = '23505';
  end if;

  if not found then
    insert into public.payments (
      reservation_id,
      payer_id,
      status,
      provider,
      provider_order_id,
      amount
    )
    values (
      selected_reservation.id,
      auth.uid(),
      'ready',
      'toss',
      'spolink_' || selected_reservation.id::text,
      selected_reservation.reserved_price_amount
    )
    returning * into selected_payment;
  end if;

  return query
    select
      selected_payment.id,
      selected_payment.provider,
      selected_payment.provider_order_id,
      selected_payment.amount,
      selected_lesson.title;
end;
$$;

revoke all on function public.create_ready_payment(uuid) from public;
grant execute on function public.create_ready_payment(uuid) to authenticated;

create or replace function public.confirm_paid_reservation(
  checked_reservation_id uuid,
  checked_provider_order_id text,
  checked_provider_payment_key text,
  checked_amount integer,
  checked_raw_payload jsonb
)
returns table (
  payment_id uuid,
  reservation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_captured_amount integer;
  provider_captured_amount_text text;
  selected_payment public.payments%rowtype;
  selected_reservation public.reservations%rowtype;
  selected_schedule public.lesson_schedules%rowtype;
begin
  provider_captured_amount_text := checked_raw_payload ->> 'totalAmount';
  if checked_raw_payload ->> 'status' is distinct from 'DONE'
    or jsonb_typeof(checked_raw_payload -> 'totalAmount') is distinct from 'number'
    or provider_captured_amount_text !~ '^[0-9]+$' then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;
  if length(provider_captured_amount_text) > 10
    or (
      length(provider_captured_amount_text) = 10
      and provider_captured_amount_text > '2147483647'
    ) then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;
  if checked_raw_payload ->> 'orderId' is distinct from checked_provider_order_id
    or checked_raw_payload ->> 'paymentKey' is distinct from checked_provider_payment_key then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;
  provider_captured_amount := provider_captured_amount_text::integer;
  if provider_captured_amount <> checked_amount then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;

  select *
    into selected_reservation
    from public.reservations
    where id = checked_reservation_id
    for update;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  select *
    into selected_payment
    from public.payments
    where payments.reservation_id = selected_reservation.id
      and payments.provider_order_id = checked_provider_order_id
    for update;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  if selected_payment.status = 'paid' then
    if selected_reservation.status <> 'confirmed' then
      raise exception 'Payment cannot be confirmed.' using errcode = '23505';
    end if;

    if selected_payment.provider_payment_key = checked_provider_payment_key
      and selected_payment.amount = checked_amount
      and selected_payment.raw_payload is not distinct from checked_raw_payload then
      return query
        select selected_payment.id, selected_reservation.id;
      return;
    end if;

    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;

  if selected_payment.status <> 'ready' or selected_reservation.status <> 'pending_payment' then
    raise exception 'Payment cannot be confirmed.' using errcode = '23505';
  end if;

  if selected_reservation.payment_expires_at <= now() then
    raise exception 'Reservation expired.' using errcode = 'P0005';
  end if;

  if selected_payment.payer_id <> selected_reservation.learner_id
    or selected_payment.amount <> checked_amount
    or selected_reservation.reserved_price_amount <> checked_amount then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;

  select *
    into selected_schedule
    from public.lesson_schedules
    where id = selected_reservation.lesson_schedule_id
    for update;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  if selected_schedule.reserved_count >= selected_schedule.capacity then
    raise exception 'Schedule capacity exceeded.' using errcode = 'P0003';
  end if;

  update public.lesson_schedules
    set reserved_count = reserved_count + 1
    where id = selected_schedule.id;

  update public.reservations
    set
      status = 'confirmed',
      confirmed_at = now(),
      payment_expires_at = null
    where id = selected_reservation.id;

  update public.payments
    set
      status = 'paid',
      provider_payment_key = checked_provider_payment_key,
      approved_at = now(),
      failed_reason = null,
      raw_payload = checked_raw_payload
    where id = selected_payment.id
    returning * into selected_payment;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    data
  )
  values (
    selected_reservation.learner_id,
    'reservation_confirmed',
    '예약이 확정되었어요',
    '결제가 승인되어 예약이 확정되었습니다.',
    jsonb_build_object('reservationId', selected_reservation.id, 'paymentId', selected_payment.id)
  );

  insert into public.audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    after_data
  )
  values (
    null,
    'payment.confirmed',
    'payment',
    selected_payment.id,
    jsonb_build_object('reservationId', selected_reservation.id, 'amount', selected_payment.amount)
  );

  return query
    select selected_payment.id, selected_reservation.id;
end;
$$;

revoke all on function public.confirm_paid_reservation(uuid, text, text, integer, jsonb) from public;
grant execute on function public.confirm_paid_reservation(uuid, text, text, integer, jsonb) to service_role;

create or replace function public.mark_payment_confirmation_failed(
  checked_reservation_id uuid,
  checked_provider_order_id text,
  checked_failed_reason text,
  checked_raw_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_payment public.payments%rowtype;
  selected_reservation public.reservations%rowtype;
begin
  select *
    into selected_reservation
    from public.reservations
    where reservations.id = checked_reservation_id
    for update;

  if not found then
    return;
  end if;

  select *
    into selected_payment
    from public.payments
    where payments.reservation_id = selected_reservation.id
      and payments.provider_order_id = checked_provider_order_id
    for update;

  if not found then
    return;
  end if;

  if selected_payment.status <> 'ready'
    or selected_reservation.status <> 'pending_payment' then
    return;
  end if;

  update public.payments
    set
      status = 'failed',
      failed_reason = checked_failed_reason,
      raw_payload = checked_raw_payload
    where payments.id = selected_payment.id;

  insert into public.audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    after_data
  )
  values (
    null,
    'payment.confirmation_failed',
    'payment',
    selected_payment.id,
    jsonb_build_object('reservationId', selected_reservation.id, 'reason', checked_failed_reason)
  );
end;
$$;

revoke all on function public.mark_payment_confirmation_failed(uuid, text, text, jsonb) from public;
grant execute on function public.mark_payment_confirmation_failed(uuid, text, text, jsonb) to service_role;

create or replace function public.mark_payment_confirmation_reconciliation_required(
  checked_reservation_id uuid,
  checked_provider_order_id text,
  checked_provider_payment_key text,
  checked_failure_code text,
  checked_raw_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_provider_evidence boolean;
  selected_payment public.payments%rowtype;
  selected_reservation public.reservations%rowtype;
  provider_captured_amount integer;
  provider_captured_amount_text text;
begin
  provider_captured_amount_text := checked_raw_payload ->> 'totalAmount';
  if checked_raw_payload ->> 'status' is distinct from 'DONE'
    or jsonb_typeof(checked_raw_payload -> 'totalAmount') is distinct from 'number'
    or provider_captured_amount_text !~ '^[0-9]+$' then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;
  if length(provider_captured_amount_text) > 10
    or (
      length(provider_captured_amount_text) = 10
      and provider_captured_amount_text > '2147483647'
    ) then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;
  if checked_raw_payload ->> 'orderId' is distinct from checked_provider_order_id
    or checked_raw_payload ->> 'paymentKey' is distinct from checked_provider_payment_key then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;
  provider_captured_amount := provider_captured_amount_text::integer;

  select *
    into selected_reservation
    from public.reservations
    where reservations.id = checked_reservation_id
    for update;

  if not found then
    return;
  end if;

  select *
    into selected_payment
    from public.payments
    where payments.reservation_id = selected_reservation.id
    for update;

  if not found then
    return;
  end if;

  if selected_payment.provider_order_id is distinct from checked_provider_order_id then
    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;

  has_provider_evidence := selected_payment.provider_payment_key is not null
    or selected_payment.approved_at is not null
    or selected_payment.failed_reason like 'confirmation_reconciliation_required:%';

  if has_provider_evidence then
    if selected_payment.provider_payment_key is distinct from checked_provider_payment_key
      or selected_payment.amount <> provider_captured_amount
      or selected_payment.approved_at is null
      or selected_payment.failed_reason is distinct from
        'confirmation_reconciliation_required:' || checked_failure_code
      or selected_payment.raw_payload is distinct from checked_raw_payload then
      raise exception 'Payment verification failed.' using errcode = 'P0007';
    end if;

    if selected_payment.status = 'ready'
      or (
        selected_payment.status = 'paid'
        and selected_reservation.status in (
          'cancelled_by_user', 'cancelled_by_coach', 'cancelled_by_admin'
        )
      ) then
      return;
    end if;

    raise exception 'Payment verification failed.' using errcode = 'P0007';
  end if;

  if selected_payment.status = 'cancelled'
    and selected_reservation.status in (
      'cancelled_by_user', 'cancelled_by_coach', 'cancelled_by_admin'
    ) then
    update public.payments
      set
        status = 'paid',
        amount = provider_captured_amount,
        provider_payment_key = checked_provider_payment_key,
        approved_at = now(),
        failed_reason = 'confirmation_reconciliation_required:' || checked_failure_code,
        raw_payload = checked_raw_payload
      where payments.id = selected_payment.id
      returning * into selected_payment;

    insert into public.refunds (
      payment_id,
      reservation_id,
      requested_by,
      amount,
      reason,
      source
    )
    values (
      selected_payment.id,
      selected_reservation.id,
      selected_reservation.learner_id,
      provider_captured_amount,
      'Provider payment confirmed after reservation cancellation.',
      'payment_confirmation_reconciliation'
    )
    ;

    insert into public.audit_logs (
      actor_id,
      action,
      target_type,
      target_id,
      after_data
    )
    values (
      null,
      'payment.confirmation_reconciliation_required',
      'payment',
      selected_payment.id,
      jsonb_build_object(
        'reservationId', selected_reservation.id,
        'providerPaymentKey', checked_provider_payment_key,
        'failureCode', checked_failure_code,
        'refundSource', 'payment_confirmation_reconciliation',
        'refundAmount', provider_captured_amount
      )
    );
    return;
  end if;

  if selected_payment.status <> 'ready' then
    return;
  end if;

  update public.payments
    set
      amount = provider_captured_amount,
      provider_payment_key = checked_provider_payment_key,
      approved_at = now(),
      failed_reason = 'confirmation_reconciliation_required:' || checked_failure_code,
      raw_payload = checked_raw_payload
    where payments.id = selected_payment.id;

  insert into public.audit_logs (
    actor_id,
    action,
    target_type,
    target_id,
    after_data
  )
  values (
    null,
    'payment.confirmation_reconciliation_required',
    'payment',
    selected_payment.id,
    jsonb_build_object(
      'reservationId', checked_reservation_id,
      'providerPaymentKey', checked_provider_payment_key,
      'failureCode', checked_failure_code
    )
  );
end;
$$;

revoke all on function public.mark_payment_confirmation_reconciliation_required(uuid, text, text, text, jsonb) from public;
grant execute on function public.mark_payment_confirmation_reconciliation_required(uuid, text, text, text, jsonb) to service_role;

create or replace function public.calculate_cancellation_refund(
  checked_amount integer,
  checked_starts_at timestamptz,
  checked_cancelled_at timestamptz,
  checked_status public.reservation_status
)
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when checked_status in ('cancelled_by_coach', 'cancelled_by_admin') then checked_amount
    when checked_status = 'cancelled_by_user'
      and checked_starts_at - checked_cancelled_at >= interval '24 hours'
      then floor(checked_amount::numeric * 70::numeric / 100::numeric)::integer
    when checked_status = 'cancelled_by_user'
      and checked_starts_at - checked_cancelled_at >= interval '3 hours'
      then floor(checked_amount::numeric * 50::numeric / 100::numeric)::integer
    else 0
  end;
$$;

revoke all on function public.calculate_cancellation_refund(integer, timestamptz, timestamptz, public.reservation_status)
  from public, anon, authenticated;

create or replace function public.cancel_reservation(
  checked_reservation_id uuid,
  checked_reason text
)
returns table (
  reservation_id uuid,
  reservation_status public.reservation_status,
  cancelled_at timestamptz,
  refund_id uuid,
  refund_amount integer,
  refund_status public.refund_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_profile public.profiles%rowtype;
  selected_reservation public.reservations%rowtype;
  selected_payment public.payments%rowtype;
  selected_schedule public.lesson_schedules%rowtype;
  selected_coach public.coach_profiles%rowtype;
  selected_refund public.refunds%rowtype;
  original_audit public.audit_logs%rowtype;
  original_status public.reservation_status;
  original_payment_status public.payment_status;
  payment_found boolean;
  actor_kind text;
  target_status public.reservation_status;
  trimmed_reason text := btrim(checked_reason);
  cancellation_instant timestamptz := transaction_timestamp();
  calculated_refund integer := 0;
  provider_captured_amount integer;
begin
  if trimmed_reason is null or char_length(trimmed_reason) not between 1 and 200 then
    raise exception 'Cancellation reason must be between 1 and 200 characters.'
      using errcode = '22023';
  end if;

  select * into acting_profile
    from public.profiles
    where id = (select auth.uid())
      and status in ('active', 'coach_approved')
      and deleted_at is null;

  if not found then
    raise exception 'Active authenticated profile required.' using errcode = '42501';
  end if;

  select * into selected_reservation
    from public.reservations
    where id = checked_reservation_id
    for update;

  if not found then
    raise exception 'Reservation not found.' using errcode = 'P0002';
  end if;
  original_status := selected_reservation.status;

  select * into selected_payment
    from public.payments
    where payments.reservation_id = selected_reservation.id
    for update;
  payment_found := found;
  if payment_found then
    original_payment_status := selected_payment.status;
  end if;

  select * into selected_coach
    from public.coach_profiles
    where id = selected_reservation.coach_profile_id;

  if acting_profile.role = 'admin' then
    actor_kind := 'admin';
    target_status := 'cancelled_by_admin';
  elsif selected_coach.user_id = acting_profile.id and selected_coach.status = 'approved' then
    actor_kind := 'coach';
    target_status := 'cancelled_by_coach';
  elsif selected_reservation.learner_id = acting_profile.id then
    actor_kind := 'learner';
    target_status := 'cancelled_by_user';
  else
    raise exception 'Reservation cancellation is not allowed.' using errcode = '42501';
  end if;

  if original_status in ('cancelled_by_user', 'cancelled_by_coach', 'cancelled_by_admin') then
    select * into original_audit
      from public.audit_logs
      where action = 'reservation.cancelled'
        and target_type = 'reservation'
        and target_id = selected_reservation.id
      order by created_at
      limit 1;

    if found
      and original_audit.actor_id = acting_profile.id
      and original_audit.after_data ->> 'reason' = trimmed_reason
      and original_status = target_status then
      select * into selected_refund
        from public.refunds
        where refunds.id = nullif(original_audit.after_data ->> 'refundId', '')::uuid;

      return query select selected_reservation.id, original_status,
        selected_reservation.cancelled_at, selected_refund.id,
        selected_refund.amount, selected_refund.status;
      return;
    end if;

    raise exception 'Reservation cancellation conflicts with the original request.'
      using errcode = '23505';
  end if;

  if original_status = 'pending_payment' then
    if actor_kind = 'coach' or (payment_found and selected_payment.status <> 'ready') then
      raise exception 'Reservation or payment cannot be cancelled.' using errcode = 'P0001';
    end if;
    if payment_found then
      if selected_payment.provider_payment_key is not null
        and selected_payment.approved_at is not null
        and selected_payment.failed_reason like 'confirmation_reconciliation_required:%'
        and selected_payment.raw_payload ->> 'status' = 'DONE' then
        provider_captured_amount := selected_payment.amount;

        update public.payments set status = 'paid', amount = provider_captured_amount
          where id = selected_payment.id returning * into selected_payment;

        insert into public.refunds (
          payment_id, reservation_id, requested_by, amount, reason, source
        ) values (
          selected_payment.id, selected_reservation.id, selected_reservation.learner_id,
          provider_captured_amount, 'Provider payment confirmed before reservation cancellation.',
          'payment_confirmation_reconciliation'
        )
        returning * into selected_refund;
      else
        update public.payments set status = 'cancelled'
          where id = selected_payment.id returning * into selected_payment;
      end if;
    end if;
  elsif original_status = 'confirmed' then
    if not payment_found or selected_payment.status <> 'paid' then
      raise exception 'Reservation or payment cannot be cancelled.' using errcode = 'P0001';
    end if;

    select * into selected_schedule
      from public.lesson_schedules
      where id = selected_reservation.lesson_schedule_id
      for update;

    if not found or selected_schedule.reserved_count <= 0 then
      raise exception 'Reservation capacity cannot be released.' using errcode = 'P0001';
    end if;

    calculated_refund := public.calculate_cancellation_refund(
      selected_reservation.reserved_price_amount,
      selected_schedule.starts_at,
      cancellation_instant,
      target_status
    );

    update public.lesson_schedules
      set reserved_count = reserved_count - 1
      where id = selected_schedule.id;

    if calculated_refund > 0 then
      insert into public.refunds (
        payment_id, reservation_id, requested_by, amount, reason, source
      ) values (
        selected_payment.id, selected_reservation.id, acting_profile.id,
        calculated_refund, trimmed_reason, 'reservation_cancellation'
      ) returning * into selected_refund;
    end if;
  else
    raise exception 'Reservation or payment cannot be cancelled.' using errcode = 'P0001';
  end if;

  update public.reservations set
      status = target_status,
      payment_expires_at = null,
      cancelled_at = cancellation_instant,
      cancellation_reason = trimmed_reason
    where id = selected_reservation.id
    returning * into selected_reservation;

  if actor_kind = 'learner' then
    insert into public.notifications (user_id, type, title, body, data) values (
      selected_coach.user_id, 'reservation_cancelled', '예약이 취소되었어요',
      '학습자가 예약을 취소했습니다.',
      jsonb_build_object('reservationId', selected_reservation.id, 'status', target_status)
    );
  elsif actor_kind = 'coach' then
    insert into public.notifications (user_id, type, title, body, data) values (
      selected_reservation.learner_id, 'reservation_cancelled', '예약이 취소되었어요',
      '지도자가 예약을 취소했습니다.',
      jsonb_build_object('reservationId', selected_reservation.id, 'status', target_status)
    );
  else
    insert into public.notifications (user_id, type, title, body, data) values
      (selected_reservation.learner_id, 'reservation_cancelled', '예약이 취소되었어요',
       '관리자가 예약을 취소했습니다.',
       jsonb_build_object('reservationId', selected_reservation.id, 'status', target_status)),
      (selected_coach.user_id, 'reservation_cancelled', '예약이 취소되었어요',
       '관리자가 예약을 취소했습니다.',
       jsonb_build_object('reservationId', selected_reservation.id, 'status', target_status));
  end if;

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, before_data, after_data
  ) values (
    acting_profile.id, 'reservation.cancelled', 'reservation', selected_reservation.id,
    jsonb_build_object('status', original_status, 'paymentStatus', original_payment_status),
    jsonb_build_object(
      'status', selected_reservation.status, 'reason', trimmed_reason,
      'actorType', actor_kind, 'refundId', selected_refund.id,
      'refundAmount', selected_refund.amount
    )
  );

  return query select selected_reservation.id, selected_reservation.status,
    selected_reservation.cancelled_at, selected_refund.id,
    selected_refund.amount, selected_refund.status;
end;
$$;

revoke all on function public.cancel_reservation(uuid, text) from public, anon;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;

create or replace function public.can_create_review(
  checked_reservation_id uuid,
  checked_lesson_id uuid,
  checked_coach_profile_id uuid,
  checked_reviewer_id uuid
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
    where reservations.id = checked_reservation_id
      and reservations.lesson_id = checked_lesson_id
      and reservations.coach_profile_id = checked_coach_profile_id
      and reservations.learner_id = checked_reviewer_id
      and reservations.learner_id = (select auth.uid())
      and reservations.status = 'completed'
  );
$$;

create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    old.role is distinct from new.role
    or old.deleted_at is distinct from new.deleted_at
  ) and not public.is_admin() then
    raise exception 'Only administrators can update profile system fields.'
      using errcode = '42501';
  end if;

  if old.status is distinct from new.status
    and not public.is_admin()
    and not (
      old.status = 'active'
      and new.status = 'pending_coach'
      and new.id = (select auth.uid())
    ) then
    raise exception 'Only coach submission can update own profile status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.protect_coach_review_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    old.reviewed_at is distinct from new.reviewed_at
    or old.reviewed_by is distinct from new.reviewed_by
    or old.rejection_reason is distinct from new.rejection_reason
    or (old.status is distinct from new.status and new.status in ('approved', 'rejected', 'suspended'))
    or (old.status in ('approved', 'suspended') and old.status is distinct from new.status)
  ) and not public.is_admin() then
    raise exception 'Only administrators can update coach review fields.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.protect_certificate_review_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    old.verified_at is distinct from new.verified_at
    or old.rejected_reason is distinct from new.rejected_reason
  ) and not public.is_admin() then
    raise exception 'Only administrators can update certificate review fields.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

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
          (old.status = 'draft' and new.status = 'pending_review')
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

create or replace function public.protect_schedule_reserved_count()
returns trigger
language plpgsql
as $$
begin
  if old.reserved_count is distinct from new.reserved_count then
    if coalesce(auth.role() <> 'service_role', true) then
      if not public.is_admin() then
        if not (
          current_user = pg_get_userbyid((
            select proowner
            from pg_proc
            where oid = 'public.cancel_reservation(uuid,text)'::regprocedure
          ))
        ) then
          raise exception 'Only trusted reservation/payment flows can update reserved_count.'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.protect_notification_read_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;

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

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profiles_protect_system_fields before update on public.profiles
  for each row execute function public.protect_profile_system_fields();
create trigger sports_set_updated_at before update on public.sports
  for each row execute function public.set_updated_at();
create trigger coach_profiles_set_updated_at before update on public.coach_profiles
  for each row execute function public.set_updated_at();
create trigger coach_profiles_protect_review_fields before update on public.coach_profiles
  for each row execute function public.protect_coach_review_fields();
create trigger coach_certificates_set_updated_at before update on public.coach_certificates
  for each row execute function public.set_updated_at();
create trigger coach_certificates_protect_review_fields before update on public.coach_certificates
  for each row execute function public.protect_certificate_review_fields();
create trigger lessons_set_updated_at before update on public.lessons
  for each row execute function public.set_updated_at();
create trigger lessons_protect_review_status before update on public.lessons
  for each row execute function public.protect_lesson_review_status();
create trigger lesson_schedules_set_updated_at before update on public.lesson_schedules
  for each row execute function public.set_updated_at();
create trigger lesson_schedules_protect_reserved_count before update on public.lesson_schedules
  for each row execute function public.protect_schedule_reserved_count();
create trigger reservations_set_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger refunds_set_updated_at before update on public.refunds
  for each row execute function public.set_updated_at();
create trigger settlements_set_updated_at before update on public.settlements
  for each row execute function public.set_updated_at();
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();
create trigger reports_set_updated_at before update on public.reports
  for each row execute function public.set_updated_at();
create trigger notifications_protect_read_update before update on public.notifications
  for each row execute function public.protect_notification_read_update();

alter table public.profiles enable row level security;
alter table public.sports enable row level security;
alter table public.coach_profiles enable row level security;
alter table public.coach_certificates enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_images enable row level security;
alter table public.lesson_schedules enable row level security;
alter table public.reservations enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.settlements enable row level security;
alter table public.reviews enable row level security;
alter table public.lesson_favorites enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (
    id = (select auth.uid())
    and role = 'learner'
    and status = 'active'
    and deleted_at is null
  );
create policy "profiles_update_own_or_admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

create policy "sports_public_active_select" on public.sports
  for select to anon, authenticated
  using (is_active or public.is_admin());
create policy "sports_admin_all" on public.sports
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "coach_profiles_select_owner_or_admin" on public.coach_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "coach_profiles_insert_own" on public.coach_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status in ('draft', 'submitted')
    and reviewed_at is null
    and reviewed_by is null
    and rejection_reason is null
  );
create policy "coach_profiles_update_own_or_admin" on public.coach_profiles
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy "coach_certificates_select_owner_or_admin" on public.coach_certificates
  for select to authenticated
  using (public.owns_coach_profile(coach_profile_id) or public.is_admin());
create policy "coach_certificates_insert_owner" on public.coach_certificates
  for insert to authenticated
  with check (
    public.owns_coach_profile(coach_profile_id)
    and verified_at is null
    and rejected_reason is null
  );
create policy "coach_certificates_update_owner_or_admin" on public.coach_certificates
  for update to authenticated
  using (public.owns_coach_profile(coach_profile_id) or public.is_admin())
  with check (public.owns_coach_profile(coach_profile_id) or public.is_admin());

create policy "lessons_public_active_select" on public.lessons
  for select to anon, authenticated
  using (
    public.lesson_is_public(id)
    or public.owns_coach_profile(coach_profile_id)
    or public.is_admin()
  );
create policy "lessons_insert_owner" on public.lessons
  for insert to authenticated
  with check (
    public.owns_coach_profile(coach_profile_id)
    and status = 'draft'
  );
create policy "lessons_update_owner_or_admin" on public.lessons
  for update to authenticated
  using (public.owns_coach_profile(coach_profile_id) or public.is_admin())
  with check (public.owns_coach_profile(coach_profile_id) or public.is_admin());

create policy "lesson_images_public_select" on public.lesson_images
  for select to anon, authenticated
  using (public.lesson_is_public(lesson_id) or public.owns_lesson(lesson_id) or public.is_admin());
create policy "lesson_images_owner_all" on public.lesson_images
  for all to authenticated
  using (public.owns_lesson(lesson_id) or public.is_admin())
  with check (public.owns_lesson(lesson_id) or public.is_admin());

create policy "lesson_schedules_public_open_select" on public.lesson_schedules
  for select to anon, authenticated
  using (is_open and public.lesson_is_public(lesson_id) or public.owns_lesson(lesson_id) or public.is_admin());
create policy "lesson_schedules_insert_owner" on public.lesson_schedules
  for insert to authenticated
  with check (
    public.owns_lesson(lesson_id)
    and reserved_count = 0
  );
create policy "lesson_schedules_update_owner_or_admin" on public.lesson_schedules
  for update to authenticated
  using (public.owns_lesson(lesson_id) or public.is_admin())
  with check (public.owns_lesson(lesson_id) or public.is_admin());

create policy "reservations_select_participants" on public.reservations
  for select to authenticated
  using (
    learner_id = (select auth.uid())
    or public.owns_coach_profile(coach_profile_id)
    or public.is_admin()
  );
create policy "reservations_insert_learner" on public.reservations
  for insert to authenticated
  with check (false);
create policy "reservations_update_admin" on public.reservations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "payments_select_related" on public.payments
  for select to authenticated
  using (payer_id = (select auth.uid()) or public.can_view_reservation(reservation_id));

create policy "refunds_select_related" on public.refunds
  for select to authenticated
  using (requested_by = (select auth.uid()) or public.can_view_reservation(reservation_id));

create policy "settlements_select_owner_or_admin" on public.settlements
  for select to authenticated
  using (public.owns_coach_profile(coach_profile_id) or public.is_admin());

create policy "reviews_public_visible_select" on public.reviews
  for select to anon, authenticated
  using (status = 'visible' or reviewer_id = (select auth.uid()) or public.is_admin());
create policy "reviews_insert_reviewer" on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and status = 'visible'
    and public.can_create_review(reservation_id, lesson_id, coach_profile_id, reviewer_id)
  );
create policy "reviews_update_admin" on public.reviews
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "lesson_favorites_owner_all" on public.lesson_favorites
  for all to authenticated
  using (learner_id = (select auth.uid()))
  with check (learner_id = (select auth.uid()));

create policy "reports_select_reporter_or_admin" on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());
create policy "reports_insert_reporter" on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'submitted');
create policy "reports_update_admin" on public.reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "blocks_owner_all" on public.blocks
  for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

create policy "notifications_select_owner_or_admin" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
;
create policy "notifications_update_read_or_admin" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

create policy "audit_logs_admin_select" on public.audit_logs
  for select to authenticated
  using (public.is_admin());

revoke all on public.payments from anon, authenticated;
grant select (
  id,
  reservation_id,
  payer_id,
  status,
  provider,
  provider_order_id,
  amount,
  approved_at,
  failed_reason,
  created_at,
  updated_at
) on public.payments to authenticated;

revoke all on public.refunds from anon, authenticated;
grant select (
  id,
  payment_id,
  reservation_id,
  requested_by,
  amount,
  reason,
  source,
  status,
  processed_at,
  created_at,
  updated_at
) on public.refunds to authenticated;

grant select on public.coach_profile_public_cards to anon, authenticated;

insert into public.sports (name, slug)
values
  ('축구', 'soccer'),
  ('야구', 'baseball'),
  ('농구', 'basketball'),
  ('테니스', 'tennis'),
  ('배드민턴', 'badminton'),
  ('러닝', 'running'),
  ('헬스', 'fitness'),
  ('필라테스', 'pilates'),
  ('요가', 'yoga'),
  ('수영', 'swimming')
on conflict (slug) do nothing;
