alter table public.refunds
  add column if not exists claim_token uuid,
  add column if not exists claim_attempt integer not null default 0,
  add column if not exists claim_idempotency_key text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists last_failure_code text,
  add column if not exists result_fingerprint text;

alter table public.refunds
  add constraint refunds_claim_attempt_check check (claim_attempt >= 0),
  add constraint refunds_claim_key_bounded_check check (
    claim_idempotency_key is null or char_length(claim_idempotency_key) between 1 and 200
  ),
  add constraint refunds_result_key_check check (
    status <> 'completed' or provider_refund_key is not null
  ),
  add constraint refunds_failed_code_check check (
    status <> 'failed' or last_failure_code is not null
  );

alter table public.settlements
  add constraint settlements_local_status_check check (status in ('pending', 'hold', 'approved')),
  add constraint settlements_paid_at_deferred_check check (paid_at is null);

create unique index if not exists refunds_claim_idempotency_once_idx
on public.refunds (id, claim_idempotency_key)
where claim_idempotency_key is not null;

create or replace function public.protect_refund_total_invariant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_payment public.payments%rowtype;
  prior_total integer;
begin
  if tg_op = 'UPDATE' and old.payment_id is distinct from new.payment_id then
    perform 1
    from public.payments
    where id in (old.payment_id, new.payment_id)
    order by id
    for update;
  else
    perform 1 from public.payments where id = new.payment_id for update;
  end if;
  select * into selected_payment from public.payments where id = new.payment_id;
  if not found then raise exception 'Refund payment not found.' using errcode = 'P0002'; end if;
  if new.amount < 0 or new.amount > selected_payment.amount then
    raise exception 'Refund amount exceeds the original payment.' using errcode = '22003';
  end if;

  select coalesce(sum(amount), 0)::integer into prior_total
  from public.refunds
  where payment_id = new.payment_id
    and id <> new.id
    and status in ('requested', 'approved', 'completed');
  if prior_total + new.amount > selected_payment.amount
    and new.status in ('requested', 'approved', 'completed') then
    raise exception 'Refund total exceeds the original payment.' using errcode = '22003';
  end if;
  if new.status = 'completed' and new.processed_at is null then
    raise exception 'Completed refunds require processed_at.' using errcode = '22023';
  end if;
  if new.status in ('requested', 'approved') and new.processed_at is not null then
    raise exception 'Pending refunds cannot have processed_at.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists refunds_protect_money_invariants on public.refunds;
create trigger refunds_protect_money_invariants
before insert or update on public.refunds
for each row execute function public.protect_refund_total_invariant();

create or replace function public.claim_refund(
  checked_refund_id uuid,
  checked_idempotency_key text
)
returns table (
  refund_id uuid,
  claim_token uuid,
  status public.refund_status,
  attempt integer,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_refund public.refunds%rowtype;
  next_token uuid;
  claimed_refund_id uuid;
  claimed_token uuid;
  claimed_status public.refund_status;
  claimed_attempt integer;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Trusted refund worker required.' using errcode = '42501';
  end if;
  if checked_idempotency_key is null or char_length(btrim(checked_idempotency_key)) not between 1 and 200 then
    raise exception 'Refund claim idempotency key is required.' using errcode = '22023';
  end if;
  select * into selected_refund from public.refunds where id = checked_refund_id for update;
  if not found then raise exception 'Refund not found.' using errcode = 'P0002'; end if;

  if selected_refund.status in ('completed', 'failed') then
    return query select selected_refund.id, selected_refund.claim_token, selected_refund.status,
      selected_refund.claim_attempt, true;
    return;
  end if;

  if selected_refund.claim_idempotency_key = btrim(checked_idempotency_key)
    and selected_refund.claim_token is not null then
    return query select selected_refund.id, selected_refund.claim_token, selected_refund.status,
      selected_refund.claim_attempt, true;
    return;
  end if;
  if selected_refund.claim_expires_at is not null
    and selected_refund.claim_expires_at > transaction_timestamp()
    and selected_refund.status = 'approved' then
    raise exception 'Refund is already claimed.' using errcode = '55P03';
  end if;

  next_token := gen_random_uuid();
  update public.refunds set
    status = 'approved',
    claim_token = next_token,
    claim_attempt = public.refunds.claim_attempt + 1,
    claim_idempotency_key = btrim(checked_idempotency_key),
    claimed_at = transaction_timestamp(),
    claim_expires_at = transaction_timestamp() + interval '5 minutes',
    last_failure_code = null,
    processed_at = null,
    provider_refund_key = null,
    result_fingerprint = null
  where id = selected_refund.id
  returning public.refunds.id, public.refunds.claim_token, public.refunds.status, public.refunds.claim_attempt
    into claimed_refund_id, claimed_token, claimed_status, claimed_attempt;
  return query select claimed_refund_id, claimed_token, claimed_status, claimed_attempt, false;
end;
$$;

create or replace function public.process_refund_result(
  checked_refund_id uuid,
  checked_action public.refund_result_action,
  checked_provider_refund_key text default null,
  checked_failure_code text default null,
  checked_raw_payload jsonb default null,
  checked_claim_token uuid default null
)
returns table (refund_id uuid, status public.refund_status, idempotent boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_refund public.refunds%rowtype;
  fingerprint text;
  next_status public.refund_status;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Trusted refund result required.' using errcode = '42501';
  end if;
  select * into selected_refund from public.refunds where id = checked_refund_id for update;
  if not found then raise exception 'Refund not found.' using errcode = 'P0002'; end if;
  fingerprint := md5(jsonb_build_object('action', checked_action, 'providerRefundKey', checked_provider_refund_key,
    'failureCode', checked_failure_code, 'payload', checked_raw_payload)::text);
  if selected_refund.result_fingerprint = fingerprint then
    return query select selected_refund.id, selected_refund.status, true; return;
  end if;
  if selected_refund.claim_token is not null and selected_refund.claim_token is distinct from checked_claim_token then
    raise exception 'Refund claim token conflicts.' using errcode = '23505';
  end if;
  if checked_action = 'complete' then
    if nullif(btrim(checked_provider_refund_key), '') is null then
      raise exception 'Completed refund requires provider result key.' using errcode = '22023';
    end if;
    next_status := 'completed';
  else
    if nullif(btrim(checked_failure_code), '') is null then
      raise exception 'Failed refund requires bounded failure code.' using errcode = '22023';
    end if;
    next_status := 'failed';
  end if;
  if selected_refund.status in ('completed', 'failed') then
    raise exception 'Conflicting refund provider result.' using errcode = '23505';
  end if;
  update public.refunds set
    status = next_status,
    provider_refund_key = nullif(btrim(checked_provider_refund_key), ''),
    last_failure_code = nullif(btrim(checked_failure_code), ''),
    raw_payload = checked_raw_payload,
    result_fingerprint = fingerprint,
    processed_at = transaction_timestamp(),
    claim_token = null,
    claim_expires_at = null
  where id = selected_refund.id;
  update public.payments p set status = case
    when (select coalesce(sum(r.amount), 0) from public.refunds r
      where r.payment_id = p.id and r.status = 'completed') >= p.amount then 'refunded'::public.payment_status
    else 'partially_refunded'::public.payment_status end
  where p.id = selected_refund.payment_id and next_status = 'completed';
  return query select selected_refund.id, next_status, false;
end;
$$;

create or replace function public.generate_settlement(checked_reservation_id uuid)
returns table (settlement_id uuid, status public.settlement_status, idempotent boolean)
language plpgsql security definer set search_path = public
as $$
declare
  r public.reservations%rowtype; p public.payments%rowtype; c public.coach_profiles%rowtype;
  existing public.settlements%rowtype; refund_total integer; pending_refunds integer;
  created_settlement_id uuid; created_status public.settlement_status;
begin
  if current_user not in ('postgres', 'service_role') and not public.is_admin() then
    raise exception 'Settlement generation is forbidden.' using errcode = '42501';
  end if;
  select * into r from public.reservations where id = checked_reservation_id for update;
  if not found then raise exception 'Reservation not found.' using errcode = 'P0002'; end if;
  select * into existing from public.settlements where reservation_id = r.id for update;
  if found then return query select existing.id, existing.status, true; return; end if;
  select * into p from public.payments where reservation_id = r.id for update;
  select * into c from public.coach_profiles where id = r.coach_profile_id for update;
  select coalesce(sum(amount), 0)::integer, count(*) filter (where public.refunds.status in ('requested', 'approved'))::integer
    into refund_total, pending_refunds from public.refunds where public.refunds.reservation_id = r.id;
  if r.status <> 'completed' or r.completed_at is null
    or r.completed_at > transaction_timestamp() - interval '24 hours'
    or p.status not in ('paid', 'partially_refunded')
    or c.status <> 'approved' or not exists (select 1 from public.profiles where public.profiles.id = c.user_id and public.profiles.status = 'coach_approved' and public.profiles.deleted_at is null)
    or pending_refunds > 0 or refund_total > p.amount then
    raise exception 'Reservation is not eligible for settlement.' using errcode = 'P0001';
  end if;
  insert into public.settlements (reservation_id, coach_profile_id, payment_id, gross_amount, refund_amount, net_amount)
  values (r.id, r.coach_profile_id, p.id, p.amount,
    (select coalesce(sum(amount), 0)::integer from public.refunds where public.refunds.reservation_id = r.id and public.refunds.status = 'completed'),
    p.amount - (select coalesce(sum(amount), 0)::integer from public.refunds where public.refunds.reservation_id = r.id and public.refunds.status = 'completed'))
  returning public.settlements.id, public.settlements.status into created_settlement_id, created_status;
  return query select created_settlement_id, created_status, false;
end;
$$;

create or replace function public.set_settlement_status(
  checked_settlement_id uuid,
  checked_action public.settlement_status_action,
  checked_hold_reason text default null
)
returns table (settlement_id uuid, status public.settlement_status, idempotent boolean)
language plpgsql security definer set search_path = public
as $$
declare s public.settlements%rowtype; actor uuid; target public.settlement_status;
begin
  select public.profiles.id into actor from public.profiles where public.profiles.id = auth.uid() and public.profiles.role = 'admin' and public.profiles.status = 'active' and public.profiles.deleted_at is null;
  if actor is null and current_user not in ('postgres', 'service_role') then raise exception 'Active admin required.' using errcode = '42501'; end if;
  select * into s from public.settlements where id = checked_settlement_id for update;
  if not found then raise exception 'Settlement not found.' using errcode = 'P0002'; end if;
  target := case checked_action when 'approve' then 'approved'::public.settlement_status else 'hold'::public.settlement_status end;
  if s.status = target and (target <> 'hold' or s.hold_reason = nullif(btrim(checked_hold_reason), '')) then
    return query select s.id, s.status, true; return;
  end if;
  if s.status not in ('pending', 'hold') then raise exception 'Settlement status cannot be changed.' using errcode = 'P0001'; end if;
  if target = 'hold' and char_length(btrim(coalesce(checked_hold_reason, ''))) not between 1 and 500 then
    raise exception 'Hold reason is required.' using errcode = '22023';
  end if;
  update public.settlements set status = target, hold_reason = case when target = 'hold' then btrim(checked_hold_reason) else null end,
    approved_at = case when target = 'approved' then transaction_timestamp() else approved_at end
  where id = s.id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, before_data, after_data)
  values (coalesce(actor, auth.uid()), 'settlement.status_changed', 'settlement', s.id,
    jsonb_build_object('status', s.status), jsonb_build_object('status', target));
  return query select s.id, target, false;
end;
$$;

revoke all on function public.claim_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_refund(uuid, text) to service_role;
revoke all on function public.process_refund_result(uuid, public.refund_result_action, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.process_refund_result(uuid, public.refund_result_action, text, text, jsonb, uuid) to service_role;
revoke all on function public.generate_settlement(uuid) from public, anon;
grant execute on function public.generate_settlement(uuid) to authenticated, service_role;
revoke all on function public.set_settlement_status(uuid, public.settlement_status_action, text) from public, anon;
grant execute on function public.set_settlement_status(uuid, public.settlement_status_action, text) to authenticated, service_role;

create unique index if not exists settlement_status_audit_once_idx
on public.audit_logs (target_id, action, ((after_data ->> 'status')))
where target_type = 'settlement' and action = 'settlement.status_changed';

grant select (claim_attempt, claimed_at, claim_expires_at, last_failure_code) on public.refunds to authenticated;
grant select on public.settlements to authenticated;
