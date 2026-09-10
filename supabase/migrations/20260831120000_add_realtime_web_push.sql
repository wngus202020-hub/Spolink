create type public.notification_push_delivery_status as enum (
  'pending',
  'processing',
  'retry',
  'delivered',
  'dead'
);

create type public.notification_push_result_action as enum (
  'delivered',
  'retry',
  'expired',
  'failed'
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (user_id, endpoint),
  constraint push_subscriptions_endpoint_check
    check (char_length(endpoint) between 20 and 2048 and endpoint ~ '^https://'),
  constraint push_subscriptions_p256dh_check
    check (char_length(p256dh) between 80 and 120 and p256dh ~ '^[A-Za-z0-9_-]+$'),
  constraint push_subscriptions_auth_check
    check (char_length(auth) between 16 and 64 and auth ~ '^[A-Za-z0-9_-]+$')
);

create table public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status public.notification_push_delivery_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default transaction_timestamp(),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  result_action public.notification_push_result_action,
  last_error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (notification_id, subscription_id),
  constraint notification_push_error_code_check
    check (last_error_code is null or char_length(last_error_code) between 1 and 100),
  constraint notification_push_delivery_state_check check (
    (status = 'delivered' and delivered_at is not null)
    or (status <> 'delivered' and delivered_at is null)
  )
);

create index push_subscriptions_active_user_idx
on public.push_subscriptions (user_id)
where disabled_at is null;

create index notification_push_deliveries_claim_idx
on public.notification_push_deliveries (next_attempt_at, created_at)
where status in ('pending', 'processing', 'retry');

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

create trigger notification_push_deliveries_set_updated_at
before update on public.notification_push_deliveries
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.notification_push_deliveries enable row level security;

create policy "push_subscriptions_owner"
on public.push_subscriptions
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.notification_push_deliveries from public, anon, authenticated;

create or replace function public.upsert_push_subscription(
  checked_endpoint text,
  checked_p256dh text,
  checked_auth text,
  checked_expiration_time timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authenticated push subscriber required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = actor
      and deleted_at is null
      and status not in ('deleted', 'suspended')
  ) then
    raise exception 'Active push subscriber required.' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    expiration_time,
    disabled_at
  ) values (
    actor,
    checked_endpoint,
    checked_p256dh,
    checked_auth,
    checked_expiration_time,
    null
  )
  on conflict (user_id, endpoint) do update
  set p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    disabled_at = null;
  return true;
end;
$$;

create or replace function public.disable_push_subscription(checked_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated push subscriber required.' using errcode = '42501';
  end if;
  update public.push_subscriptions
  set disabled_at = coalesce(disabled_at, transaction_timestamp())
  where user_id = auth.uid()
    and endpoint = checked_endpoint
  returning id into changed_id;
  return changed_id is not null;
end;
$$;

create or replace function public.enqueue_notification_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_push_deliveries (notification_id, subscription_id)
  select new.id, subscription.id
  from public.push_subscriptions as subscription
  where subscription.user_id = new.user_id
    and subscription.disabled_at is null
  on conflict (notification_id, subscription_id) do nothing;
  return new;
end;
$$;

create trigger notifications_enqueue_push_deliveries
after insert on public.notifications
for each row execute function public.enqueue_notification_push_deliveries();

create or replace function public.close_disabled_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.disabled_at is not null and old.disabled_at is null then
    update public.notification_push_deliveries
    set status = 'dead',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error_code = 'PUSH_SUBSCRIPTION_DISABLED'
    where subscription_id = new.id
      and status in ('pending', 'processing', 'retry');
  end if;
  return new;
end;
$$;

create trigger push_subscriptions_close_deliveries
after update of disabled_at on public.push_subscriptions
for each row execute function public.close_disabled_push_deliveries();

create or replace function public.claim_notification_push_deliveries(
  checked_limit integer default 25
)
returns table (
  delivery_id uuid,
  claim_token uuid,
  attempt integer,
  endpoint text,
  p256dh text,
  auth text,
  notification_id uuid,
  notification_type public.notification_type,
  title text,
  body text,
  data jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Trusted push worker required.' using errcode = '42501';
  end if;
  if checked_limit not between 1 and 100 then
    raise exception 'Push delivery claim limit is invalid.' using errcode = '22023';
  end if;

  update public.notification_push_deliveries
  set status = 'dead',
    claim_token = null,
    claimed_at = null,
    claim_expires_at = null,
    last_error_code = 'PUSH_LEASE_EXHAUSTED'
  where status = 'processing'
    and claim_expires_at <= transaction_timestamp()
    and attempt_count >= 5;

  return query
  with candidates as (
    select delivery.id
    from public.notification_push_deliveries as delivery
    join public.push_subscriptions as subscription on subscription.id = delivery.subscription_id
    where subscription.disabled_at is null
      and delivery.attempt_count < 5
      and (
        (delivery.status in ('pending', 'retry') and delivery.next_attempt_at <= transaction_timestamp())
        or (delivery.status = 'processing' and delivery.claim_expires_at <= transaction_timestamp())
      )
    order by delivery.next_attempt_at, delivery.created_at, delivery.id
    for update of delivery skip locked
    limit checked_limit
  ), claimed as (
    update public.notification_push_deliveries as delivery
    set status = 'processing',
      claim_token = gen_random_uuid(),
      claimed_at = transaction_timestamp(),
      claim_expires_at = transaction_timestamp() + interval '2 minutes',
      attempt_count = delivery.attempt_count + 1,
      result_action = null,
      last_error_code = null
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select claimed.id,
    claimed.claim_token,
    claimed.attempt_count,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    notification.id,
    notification.type,
    notification.title,
    notification.body,
    notification.data
  from claimed
  join public.push_subscriptions as subscription on subscription.id = claimed.subscription_id
  join public.notifications as notification on notification.id = claimed.notification_id
  order by claimed.created_at, claimed.id;
end;
$$;

create or replace function public.record_notification_push_delivery_result(
  checked_delivery_id uuid,
  checked_claim_token uuid,
  checked_action public.notification_push_result_action,
  checked_error_code text default null
)
returns table (
  delivery_id uuid,
  status public.notification_push_delivery_status,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_delivery public.notification_push_deliveries%rowtype;
  next_status public.notification_push_delivery_status;
  normalized_error text := nullif(btrim(checked_error_code), '');
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Trusted push result worker required.' using errcode = '42501';
  end if;
  select * into selected_delivery
  from public.notification_push_deliveries
  where id = checked_delivery_id
  for update;
  if not found then
    raise exception 'Push delivery not found.' using errcode = 'P0002';
  end if;
  if selected_delivery.claim_token is distinct from checked_claim_token then
    raise exception 'Push delivery claim token conflicts.' using errcode = '23505';
  end if;
  if selected_delivery.status in ('delivered', 'dead', 'retry') then
    if selected_delivery.result_action is not distinct from checked_action
      and selected_delivery.last_error_code is not distinct from normalized_error then
      return query select selected_delivery.id, selected_delivery.status, true;
      return;
    end if;
    raise exception 'Conflicting push delivery result.' using errcode = '23505';
  end if;
  if selected_delivery.status <> 'processing' then
    raise exception 'Push delivery is not claimed.' using errcode = 'P0001';
  end if;
  if checked_action <> 'delivered'
    and (normalized_error is null or char_length(normalized_error) > 100) then
    raise exception 'Push failure requires a bounded error code.' using errcode = '22023';
  end if;
  if checked_action = 'delivered' and normalized_error is not null then
    raise exception 'Delivered push result cannot include an error code.' using errcode = '22023';
  end if;

  next_status := case
    when checked_action = 'delivered' then 'delivered'::public.notification_push_delivery_status
    when checked_action = 'retry' and selected_delivery.attempt_count < 5
      then 'retry'::public.notification_push_delivery_status
    else 'dead'::public.notification_push_delivery_status
  end;

  update public.notification_push_deliveries
  set status = next_status,
    next_attempt_at = case
      when next_status = 'retry' then transaction_timestamp()
        + make_interval(mins => least(60, (2 ^ selected_delivery.attempt_count)::integer))
      else next_attempt_at
    end,
    claim_expires_at = null,
    result_action = checked_action,
    delivered_at = case when next_status = 'delivered' then transaction_timestamp() else null end,
    last_error_code = normalized_error
  where id = selected_delivery.id;

  if checked_action = 'expired' then
    update public.push_subscriptions
    set disabled_at = coalesce(disabled_at, transaction_timestamp())
    where id = selected_delivery.subscription_id;
  end if;

  return query select selected_delivery.id, next_status, false;
end;
$$;

revoke all on function public.enqueue_notification_push_deliveries()
from public, anon, authenticated;
revoke all on function public.close_disabled_push_deliveries()
from public, anon, authenticated;
revoke all on function public.claim_notification_push_deliveries(integer)
from public, anon, authenticated;
revoke all on function public.record_notification_push_delivery_result(
  uuid,
  uuid,
  public.notification_push_result_action,
  text
) from public, anon, authenticated;

revoke all on function public.upsert_push_subscription(text, text, text, timestamptz)
from public, anon;
revoke all on function public.disable_push_subscription(text)
from public, anon;

grant execute on function public.claim_notification_push_deliveries(integer) to service_role;
grant execute on function public.record_notification_push_delivery_result(
  uuid,
  uuid,
  public.notification_push_result_action,
  text
) to service_role;
grant execute on function public.upsert_push_subscription(text, text, text, timestamptz)
to authenticated;
grant execute on function public.disable_push_subscription(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
