import assert from "node:assert/strict"

export async function readCancellationState(db) {
  await db.exec("reset role")
  const result = await db.query(`
    select r.status as reservation_status, r.cancelled_at, r.cancellation_reason,
      r.payment_expires_at, p.status as payment_status, s.reserved_count,
      f.id as refund_id, f.amount as refund_amount, f.source as refund_source,
      f.requested_by, f.status as refund_status,
      (select count(*)::integer from public.notifications) as notification_count,
      (select count(*)::integer from public.audit_logs) as audit_count
    from public.reservations r
    join public.payments p on p.reservation_id = r.id
    join public.lesson_schedules s on s.id = r.lesson_schedule_id
    left join public.refunds f
      on f.reservation_id = r.id and f.source = 'reservation_cancellation'
  `)
  await db.exec("set role authenticated")

  assert.equal(result.rows.length, 1)
  return result.rows[0]
}

export async function readNotificationRecipients(db) {
  await db.exec("reset role")
  const result = await db.query("select user_id from public.notifications order by user_id")
  await db.exec("set role authenticated")
  return result.rows.map((row) => row.user_id)
}

export async function expectSqlState(action, code) {
  await assert.rejects(action, (error) => error.code === code)
}

export function cancellationSnapshot(state) {
  return {
    audit_count: state.audit_count,
    cancellation_reason: state.cancellation_reason,
    cancelled_at: state.cancelled_at,
    notification_count: state.notification_count,
    payment_status: state.payment_status,
    refund_amount: state.refund_amount,
    reservation_status: state.reservation_status,
    reserved_count: state.reserved_count,
  }
}
