import assert from "node:assert/strict"

export function assertPristinePolicyState(state, slot, provision, overrides = {}) {
  const schedule = findRow(provision.rows.schedules, slot.scheduleId)
  const reservation = {
    ...findRow(provision.rows.reservations, slot.reservationId),
    ...overrides.reservation,
  }
  const payment = { ...findRow(provision.rows.payments, slot.paymentId), ...overrides.payment }

  assert.deepEqual(state.reservation, {
    cancellation_reason: reservation.cancellation_reason,
    coach_profile_id: reservation.coach_profile_id,
    has_cancelled_at: reservation.cancelled_at !== null,
    has_completed_at: false,
    has_confirmed_at: reservation.confirmed_at !== null,
    has_payment_expiry: reservation.payment_expires_at !== null,
    id: slot.reservationId,
    learner_id: reservation.learner_id,
    lesson_schedule_id: slot.scheduleId,
    reserved_price_amount: reservation.reserved_price_amount,
    status: reservation.status,
  })
  assert.deepEqual(state.payment, {
    amount: payment.amount,
    failed_reason: payment.failed_reason,
    has_approved_at: payment.approved_at !== null,
    has_provider_key: payment.provider_payment_key !== null,
    has_raw_payload: payment.raw_payload !== null,
    id: slot.paymentId,
    payer_id: payment.payer_id,
    provider: payment.provider,
    provider_order_id: payment.provider_order_id,
    reservation_id: slot.reservationId,
    status: payment.status,
  })
  assert.deepEqual(state.schedule, {
    capacity: schedule.capacity,
    id: slot.scheduleId,
    is_open: schedule.is_open,
    reserved_count: overrides.reservedCount ?? schedule.reserved_count,
  })
  assert.deepEqual(state.refunds, [])
  assert.deepEqual(state.notifications, [])
  assert.deepEqual(state.audits, [])
}

export function assertCancelledPolicyState(state, expected) {
  assert.equal(state.reservation.status, expected.status)
  assert.equal(state.reservation.cancellation_reason, expected.reason)
  assert.equal(state.reservation.has_cancelled_at, true)
  assert.equal(state.payment.status, expected.paymentStatus)
  assert.equal(state.schedule.reserved_count, expected.reservedCount)
  assert.deepEqual(
    state.refunds.map(({ amount, requested_by, source, status }) => ({
      amount,
      requested_by,
      source,
      status,
    })),
    expected.refunds,
  )
  assert.deepEqual(
    state.notifications.map(({ status, type, user_id }) => ({ status, type, user_id })),
    expected.notifications,
  )
  assert.deepEqual(
    state.audits.map((audit) => ({
      actor_id: audit.actor_id,
      actor_type: audit.actor_type,
      after_status: audit.after_status,
      before_payment_status: audit.before_payment_status,
      before_status: audit.before_status,
      refund_amount: audit.refund_amount,
    })),
    expected.audits,
  )
}

export function findRow(rows, id) {
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`Missing fixture row: ${id}`)
  return row
}
