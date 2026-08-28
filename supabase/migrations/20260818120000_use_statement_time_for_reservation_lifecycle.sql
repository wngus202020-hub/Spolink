create or replace function public.transition_reservation_lifecycle(
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
  selected_settlement public.settlements%rowtype;
  selected_refund public.refunds%rowtype;
  existing_audit public.audit_logs%rowtype;
  trimmed_reason text := nullif(btrim(checked_reason), '');
  target_status public.reservation_status;
  transition_instant timestamptz := statement_timestamp();
begin
  if checked_action not in ('complete', 'mark_learner_no_show', 'mark_coach_no_show', 'cancel') then
    raise exception 'Reservation lifecycle action is not available.' using errcode = '22023';
  end if;

  if checked_action = 'cancel' then
    return query
    select cancellation.reservation_id, cancellation.reservation_status,
      cancellation.cancelled_at, null::timestamptz, null::timestamptz,
      null::uuid, cancellation.refund_id, cancellation.refund_amount,
      cancellation.refund_status
    from public.cancel_reservation(checked_reservation_id, checked_reason) as cancellation;
    return;
  end if;

  if checked_action <> 'complete'
    and (trimmed_reason is null or char_length(trimmed_reason) > 200) then
    raise exception 'No-show reason must be between 1 and 200 characters.' using errcode = '22023';
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

  select * into selected_coach from public.coach_profiles
  where id = selected_reservation.coach_profile_id;
  if acting_profile.role <> 'admin'
    and not (
      selected_coach.user_id = acting_profile.id
      and selected_coach.status = 'approved'
      and acting_profile.status = 'coach_approved'
    ) then
    raise exception 'Reservation lifecycle action is not allowed.' using errcode = '42501';
  end if;

  if checked_action = 'complete' then
    target_status := 'completed';
  elsif checked_action = 'mark_learner_no_show' then
    target_status := 'no_show_user';
  else
    target_status := 'no_show_coach';
  end if;

  if selected_reservation.status = target_status then
    select * into existing_audit
    from public.audit_logs
    where action = case when target_status = 'completed'
      then 'reservation.completed' else 'reservation.no_show' end
      and target_type = 'reservation'
      and target_id = selected_reservation.id
    order by created_at
    limit 1;
    if found and (existing_audit.after_data ->> 'reason') is not distinct from trimmed_reason then
      select * into selected_settlement from public.settlements
      where settlements.reservation_id = selected_reservation.id;
      select * into selected_refund from public.refunds
      where refunds.reservation_id = selected_reservation.id
        and reason = 'reservation.coach_no_show'
      order by created_at limit 1;
      return query select selected_reservation.id, selected_reservation.status,
        null::timestamptz, selected_reservation.completed_at, selected_reservation.no_show_marked_at,
        selected_settlement.id, selected_refund.id, selected_refund.amount, selected_refund.status;
      return;
    end if;

    if found then
      raise exception 'Reservation lifecycle conflicts with the original request.'
        using errcode = '23505';
    end if;
  end if;

  if selected_reservation.status <> 'confirmed' then
    raise exception 'Reservation cannot be transitioned from its current state.' using errcode = 'P0001';
  end if;

  select * into selected_payment from public.payments
  where payments.reservation_id = selected_reservation.id
  for update;
  if not found or selected_payment.status <> 'paid' then
    raise exception 'A paid confirmed reservation is required.' using errcode = 'P0001';
  end if;

  select * into selected_schedule from public.lesson_schedules
  where id = selected_reservation.lesson_schedule_id
  for update;
  if not found then
    raise exception 'Reservation schedule not found.' using errcode = 'P0002';
  end if;

  if checked_action <> 'complete'
    and transition_instant < public.reservation_no_show_available_at(selected_schedule.starts_at) then
    raise exception 'No-show can be recorded 15 minutes after the schedule starts.' using errcode = '22023';
  end if;

  if checked_action = 'complete' then
    update public.reservations
    set status = target_status, completed_at = transition_instant
    where id = selected_reservation.id
    returning * into selected_reservation;

    insert into public.settlements (
      reservation_id, coach_profile_id, payment_id, gross_amount, net_amount
    ) values (
      selected_reservation.id, selected_reservation.coach_profile_id, selected_payment.id,
      selected_reservation.reserved_price_amount, selected_reservation.reserved_price_amount
    ) returning * into selected_settlement;

    insert into public.notifications (user_id, type, title, body, data) values
      (selected_reservation.learner_id, 'reservation.completed', '수업이 완료되었어요',
       '수업이 완료되었습니다.', jsonb_build_object('reservationId', selected_reservation.id)),
      (selected_reservation.learner_id, 'review.requested', '수업 후기를 남겨주세요',
       '수업은 어떠셨나요?', jsonb_build_object('reservationId', selected_reservation.id, 'lessonId', selected_reservation.lesson_id));
  else
    update public.reservations
    set status = target_status, no_show_marked_at = transition_instant
    where id = selected_reservation.id
    returning * into selected_reservation;

    if checked_action = 'mark_coach_no_show' then
      insert into public.refunds (
        payment_id, reservation_id, requested_by, amount, reason, source
      ) values (
        selected_payment.id, selected_reservation.id, acting_profile.id,
        selected_reservation.reserved_price_amount, 'reservation.coach_no_show',
        'manual'
      ) returning * into selected_refund;
    end if;

    insert into public.notifications (user_id, type, title, body, data) values
      (selected_reservation.learner_id, 'reservation.no_show', '노쇼가 처리되었어요',
       '예약 상태가 노쇼로 처리되었습니다.', jsonb_build_object('reservationId', selected_reservation.id, 'status', target_status));
  end if;

  insert into public.audit_logs (
    actor_id, action, target_type, target_id, before_data, after_data
  ) values (
    acting_profile.id,
    case when target_status = 'completed' then 'reservation.completed' else 'reservation.no_show' end,
    'reservation', selected_reservation.id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', target_status, 'reason', trimmed_reason)
  );

  return query select selected_reservation.id, selected_reservation.status,
    null::timestamptz, selected_reservation.completed_at, selected_reservation.no_show_marked_at,
    selected_settlement.id, selected_refund.id, selected_refund.amount, selected_refund.status;
end;
$$;

revoke all on function public.transition_reservation_lifecycle(uuid, public.reservation_status_action, text)
from public, anon;
grant execute on function public.transition_reservation_lifecycle(uuid, public.reservation_status_action, text)
to authenticated;
