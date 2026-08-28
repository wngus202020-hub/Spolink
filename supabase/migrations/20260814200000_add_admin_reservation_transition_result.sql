create or replace function public.transition_admin_reservation(
  checked_reservation_id uuid,
  checked_action public.reservation_status_action,
  checked_reason text default null
)
returns table (
  reservation_id uuid,
  reservation_status public.reservation_status,
  cancelled_at timestamptz,
  completed_at timestamptz,
  no_show_marked_at timestamptz,
  settlement_id uuid,
  refund_id uuid,
  refund_amount integer,
  refund_status public.refund_status,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  selected public.reservations%rowtype;
  existing_audit public.audit_logs%rowtype;
  trimmed_reason text := nullif(btrim(checked_reason), '');
  audit_action text;
  replay boolean := false;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and role = 'admin'
    and status = 'active'
    and deleted_at is null;
  if not found then
    raise exception 'Active administrator required.' using errcode = '42501';
  end if;

  if checked_action not in (
    'complete', 'mark_learner_no_show', 'mark_coach_no_show', 'open_dispute', 'cancel'
  ) then
    raise exception 'Reservation action is not available.' using errcode = '22023';
  end if;
  if checked_action = 'cancel' and trimmed_reason is null then
    raise exception 'Cancellation reason is required.' using errcode = '22023';
  end if;

  select * into selected
  from public.reservations
  where id = checked_reservation_id
  for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'P0002';
  end if;

  audit_action := case checked_action
    when 'complete' then 'reservation.completed'
    when 'open_dispute' then 'reservation.disputed'
    when 'cancel' then 'reservation.cancelled'
    else 'reservation.no_show'
  end;
  select * into existing_audit
  from public.audit_logs
  where action = audit_action
    and target_type = 'reservation'
    and target_id = selected.id
    and (after_data ->> 'reason') is not distinct from trimmed_reason
  order by created_at
  limit 1;
  replay := found;

  if checked_action in ('complete', 'mark_learner_no_show', 'mark_coach_no_show') then
    return query
    select lifecycle.reservation_id, lifecycle.reservation_status,
      lifecycle.cancelled_at, lifecycle.completed_at, lifecycle.no_show_marked_at,
      lifecycle.settlement_id, lifecycle.refund_id, lifecycle.refund_amount,
      lifecycle.refund_status, replay
    from public.transition_reservation_lifecycle(
      checked_reservation_id, checked_action, checked_reason
    ) as lifecycle;
  else
    return query
    select transition.reservation_id, transition.reservation_status,
      transition.cancelled_at, null::timestamptz, null::timestamptz,
      null::uuid, transition.refund_id, transition.refund_amount,
      transition.refund_status, replay
    from public.transition_reservation(
      checked_reservation_id, checked_action, checked_reason
    ) as transition;
  end if;
end;
$$;

revoke all on function public.transition_admin_reservation(uuid, public.reservation_status_action, text)
from public, anon;
grant execute on function public.transition_admin_reservation(uuid, public.reservation_status_action, text)
to authenticated;
