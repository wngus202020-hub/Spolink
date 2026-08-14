import assert from "node:assert/strict"

export async function readCancelledReconciliationState(db) {
  const result = await db.query(`
    select
      r.status as reservation_status,
      p.status as payment_status,
      p.provider_payment_key,
      p.approved_at is not null as approved,
      p.failed_reason,
      p.raw_payload,
      s.reserved_count,
      count(distinct f.id)::integer as refund_count,
      max(f.amount)::integer as refund_amount,
      max(f.reason) as refund_reason,
      max(f.source) as refund_source,
      max(f.requested_by::text) as refund_requested_by,
      max(f.status::text) as refund_status,
      count(distinct a.id)::integer as reconciliation_audit_count
    from public.reservations r
    join public.payments p on p.reservation_id = r.id
    join public.lesson_schedules s on s.id = r.lesson_schedule_id
    left join public.refunds f on f.reservation_id = r.id
      and f.source = 'payment_confirmation_reconciliation'
    left join public.audit_logs a on a.target_id = p.id
      and a.action = 'payment.confirmation_reconciliation_required'
    group by r.status, p.status, p.provider_payment_key, p.approved_at,
      p.failed_reason, p.raw_payload, s.reserved_count
  `)

  assert.equal(result.rows.length, 1)
  return result.rows[0]
}

export async function readReconciliationIntegritySnapshot(db) {
  await db.exec("reset role")

  const tableNames = [
    "payments",
    "refunds",
    "reservations",
    "lesson_schedules",
    "audit_logs",
    "notifications",
  ]
  const snapshot = {}

  for (const tableName of tableNames) {
    const result = await db.query(`select * from public.${tableName} order by id`)
    snapshot[tableName] = result.rows
  }

  return snapshot
}
