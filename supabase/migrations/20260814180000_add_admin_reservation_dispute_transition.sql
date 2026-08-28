create or replace function public.transition_reservation(
  checked_reservation_id uuid,
  checked_action public.reservation_status_action,
  checked_reason text default null
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
  actor public.profiles%rowtype;
  selected public.reservations%rowtype;
  trimmed_reason text := nullif(btrim(checked_reason), '');
begin
  if checked_action not in ('open_dispute', 'cancel') then
    raise exception 'Reservation action is not available in the shared transition boundary.'
      using errcode = '22023';
  end if;

  if checked_action = 'cancel' then
    return query
    select cancellation.reservation_id, cancellation.reservation_status,
      cancellation.cancelled_at, cancellation.refund_id, cancellation.refund_amount,
      cancellation.refund_status
    from public.cancel_reservation(checked_reservation_id, checked_reason) as cancellation;
    return;
  end if;

  if trimmed_reason is null or char_length(trimmed_reason) > 200 then
    raise exception 'A dispute reason must be between 1 and 200 characters.' using errcode = '22023';
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid()
    and role = 'admin'
    and status = 'active'
    and deleted_at is null;
  if not found then
    raise exception 'Active administrator required.' using errcode = '42501';
  end if;

  select * into selected from public.reservations
  where id = checked_reservation_id for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'P0002';
  end if;
  if selected.status = 'disputed' then
    if selected.dispute_reason is not distinct from trimmed_reason then
      return query select selected.id, selected.status, selected.cancelled_at,
        null::uuid, null::integer, null::public.refund_status;
      return;
    end if;
    raise exception 'Reservation dispute state has changed.' using errcode = 'P0001';
  end if;
  if selected.status not in ('confirmed', 'completed') then
    raise exception 'Reservation cannot be disputed from its current state.' using errcode = 'P0001';
  end if;

  update public.reservations
  set status = 'disputed', dispute_reason = trimmed_reason
  where id = selected.id;

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, before_data, after_data
  ) values (
    actor.id, 'reservation.disputed', 'reservation', selected.id,
    jsonb_build_object('status', selected.status),
    jsonb_build_object('status', 'disputed', 'reason', trimmed_reason)
  );

  return query select selected.id, 'disputed'::public.reservation_status,
    selected.cancelled_at, null::uuid, null::integer, null::public.refund_status;
end;
$$;

revoke all on function public.transition_reservation(uuid, public.reservation_status_action, text)
from public, anon;
grant execute on function public.transition_reservation(uuid, public.reservation_status_action, text)
to authenticated;
