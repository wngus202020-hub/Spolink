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
set search_path = public
as $$
begin
  if checked_action is null or checked_action <> 'cancel' then
    raise exception 'Reservation action is not available in the shared transition boundary.'
      using errcode = '22023';
  end if;

  return query
  select cancellation.*
  from public.cancel_reservation(checked_reservation_id, checked_reason) as cancellation;
end;
$$;

revoke all on function public.transition_reservation(
  uuid,
  public.reservation_status_action,
  text
) from public, anon;
grant execute on function public.transition_reservation(
  uuid,
  public.reservation_status_action,
  text
) to authenticated;
