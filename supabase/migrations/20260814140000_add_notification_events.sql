alter table public.notifications
  add column event_key text;

alter table public.notifications
  add constraint notifications_event_key_bounded_check
  check (event_key is null or char_length(public.js_trim(event_key)) between 1 and 200);

create unique index notification_event_once_idx
on public.notifications (user_id, type, event_key)
where event_key is not null;

revoke select on public.notifications from anon, authenticated;
grant select (id, user_id, type, title, body, data, read_at, created_at)
on public.notifications to authenticated;

create or replace function public.emit_notification_once(
  checked_user_id uuid,
  checked_type public.notification_type,
  checked_title text,
  checked_body text,
  checked_data jsonb,
  checked_event_key text
)
returns table (notification_id uuid, idempotent boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_event_key text := public.js_trim(checked_event_key);
  inserted_id uuid;
  existing_id uuid;
begin
  if checked_user_id is null or normalized_event_key is null then
    raise exception 'Notification recipient and event key are required.' using errcode = '22023';
  end if;
  if not public.notification_data_is_safe(checked_type, checked_data) then
    raise exception 'Notification data is not allowed.' using errcode = '22023';
  end if;
  if char_length(public.js_trim(checked_title)) not between 1 and 120
    or (checked_body is not null and char_length(public.js_trim(checked_body)) not between 1 and 1000) then
    raise exception 'Notification text is not allowed.' using errcode = '22023';
  end if;

  begin
    insert into public.notifications (user_id, type, title, body, data, event_key)
    values (checked_user_id, checked_type, public.js_trim(checked_title), nullif(public.js_trim(checked_body), ''), checked_data, normalized_event_key)
    returning id into inserted_id;
    return query select inserted_id, false;
  exception when unique_violation then
    select id into existing_id
    from public.notifications
    where user_id = checked_user_id
      and type = checked_type
      and event_key = normalized_event_key
    limit 1;
    return query select existing_id, true;
  end;
end;
$$;

revoke all on function public.emit_notification_once(uuid, public.notification_type, text, text, jsonb, text)
from public, anon, authenticated;

create unique index if not exists refund_result_notification_once_idx
on public.notifications (type, ((data ->> 'refundId')))
where type = 'refund.result'::public.notification_type;

create unique index if not exists settlement_status_notification_once_idx
on public.notifications (type, ((data ->> 'settlementId')), ((data ->> 'status')))
where type = 'settlement.status_changed'::public.notification_type;

create or replace function public.emit_refund_result_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
begin
  if new.status not in ('completed', 'failed')
    or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;
  select payer_id into recipient_id from public.payments where id = new.payment_id;
  if recipient_id is not null then
    perform public.emit_notification_once(
      recipient_id,
      'refund.result',
      '환불 처리 결과가 등록되었습니다',
      null,
      jsonb_build_object('refundId', new.id, 'reservationId', new.reservation_id, 'status', new.status),
      'refund:' || new.id::text || ':' || new.status::text
    );
  end if;
  return new;
end;
$$;

create or replace function public.emit_settlement_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
begin
  if tg_op <> 'UPDATE' or old.status = new.status then
    return new;
  end if;
  select user_id into recipient_id
  from public.coach_profiles
  where id = new.coach_profile_id;
  if recipient_id is not null then
    perform public.emit_notification_once(
      recipient_id,
      'settlement.status_changed',
      '정산 상태가 변경되었습니다',
      null,
      jsonb_build_object('settlementId', new.id, 'reservationId', new.reservation_id, 'status', new.status),
      'settlement:' || new.id::text || ':' || new.status::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists refunds_emit_result_notification on public.refunds;
create trigger refunds_emit_result_notification
after insert or update of status on public.refunds
for each row execute function public.emit_refund_result_notification();

drop trigger if exists settlements_emit_status_notification on public.settlements;
create trigger settlements_emit_status_notification
after update of status on public.settlements
for each row execute function public.emit_settlement_status_notification();

revoke all on function public.emit_refund_result_notification() from public, anon, authenticated;
revoke all on function public.emit_settlement_status_notification() from public, anon, authenticated;
