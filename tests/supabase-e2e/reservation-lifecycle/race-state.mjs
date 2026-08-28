import assert from "node:assert/strict"

export async function readLifecycleState(sql, slot) {
  const [state] = await sql`
    select
      (select row_to_json(row) from (
        select status::text,
          completed_at is not null as completed,
          no_show_marked_at is not null as no_show,
          cancelled_at is not null as cancelled,
          cancellation_reason
        from public.reservations where id = ${slot.reservationId}
      ) row) as reservation,
      (select row_to_json(row) from (
        select status::text, approved_at is not null as approved
        from public.payments where id = ${slot.paymentId}
      ) row) as payment,
      (select reserved_count from public.lesson_schedules where id = ${slot.scheduleId})
        as reserved_count,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.source, row.reason), '[]')
       from (
         select amount, reason, source::text, status::text
         from public.refunds where reservation_id = ${slot.reservationId}
       ) row) as refunds,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.status, row.gross_amount), '[]')
       from (
         select gross_amount, net_amount, status::text
         from public.settlements where reservation_id = ${slot.reservationId}
       ) row) as settlements,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.action), '[]')
       from (
         select audit.action, profile.role::text as actor_role,
           audit.before_data->>'status' as before_status,
           audit.after_data->>'status' as after_status,
           audit.after_data->>'reason' as reason
         from public.audit_logs audit
         left join public.profiles profile on profile.id = audit.actor_id
         where audit.target_id in (${slot.reservationId}, ${slot.paymentId})
       ) row) as audits,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.type), '[]')
       from (
         select type::text, data->>'status' as status
         from public.notifications where data->>'reservationId' = ${slot.reservationId}
       ) row) as notifications
  `
  return state
}

export async function countPendingLockWorkers(sql, pids) {
  const [row] = await sql`
    select count(*)::int as count
    from pg_stat_activity
    where pid in ${sql(pids)} and wait_event_type = 'Lock'
  `
  return row.count
}

export function assertLifecycleState(actual, expected) {
  assert.deepEqual(actual, expected)
}

export function completedState(actorRole = "coach") {
  return state({
    audits: [audit("reservation.completed", actorRole, "confirmed", "completed", null)],
    notifications: [notification("reservation.completed"), notification("review.requested")],
    reservation: reservation("completed", { completed: true }),
    settlements: [{ gross_amount: 10001, net_amount: 10001, status: "pending" }],
  })
}

export function learnerNoShowState(reason, actorRole = "coach") {
  return state({
    audits: [audit("reservation.no_show", actorRole, "confirmed", "no_show_user", reason)],
    notifications: [notification("reservation.no_show", "no_show_user")],
    reservation: reservation("no_show_user", { noShow: true }),
  })
}

export function coachNoShowState(reason, actorRole = "admin") {
  return state({
    audits: [audit("reservation.no_show", actorRole, "confirmed", "no_show_coach", reason)],
    notifications: [notification("reservation.no_show", "no_show_coach")],
    refunds: [
      {
        amount: 10001,
        reason: "reservation.coach_no_show",
        source: "manual",
        status: "requested",
      },
    ],
    reservation: reservation("no_show_coach", { noShow: true }),
  })
}

export function confirmedPaymentState() {
  return state({
    audits: [audit("payment.confirmed", null, null, null, null)],
    notifications: [notification("reservation_confirmed")],
    reservation: reservation("confirmed"),
  })
}

function state(overrides) {
  return {
    audits: overrides.audits ?? [],
    notifications: overrides.notifications ?? [],
    payment: { approved: true, status: "paid" },
    refunds: overrides.refunds ?? [],
    reservation: overrides.reservation,
    reserved_count: 1,
    settlements: overrides.settlements ?? [],
  }
}

function reservation(status, overrides = {}) {
  return {
    cancellation_reason: null,
    cancelled: false,
    completed: overrides.completed ?? false,
    no_show: overrides.noShow ?? false,
    status,
  }
}

function audit(action, actorRole, beforeStatus, afterStatus, reason) {
  return {
    action,
    actor_role: actorRole,
    after_status: afterStatus,
    before_status: beforeStatus,
    reason,
  }
}

function notification(type, status = null) {
  return { status, type }
}
