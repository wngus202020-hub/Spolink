import assert from "node:assert/strict"
import test from "node:test"

import { readCancelledReconciliationState } from "./payment-confirm-reconciliation-observables.mjs"
import {
  assertContradictoryEvidenceRetryRejected,
  assertMalformedProviderEvidenceRejected,
  contradictoryEvidenceScenarios,
  loadPaymentReconciliationFunction,
  reconciliationReservationStates,
  setReconciliationServiceRole,
} from "./payment-confirm-reconciliation-test-helpers.mjs"
import {
  markPaymentConfirmationReconciliationRequired,
  providerPaymentKey,
} from "./payment-confirm-sql-test-helpers.mjs"
import {
  cancelReservation,
  createCancellationTestDatabase,
  ids,
  seedCancellationScenario,
  setAuthenticatedUser,
} from "./reservation-cancel-sql-fixtures.mjs"

const providerCapturedAmount = 9000
const providerDonePayload = {
  orderId: `spolink_${ids.reservation}`,
  paymentKey: providerPaymentKey,
  status: "DONE",
  totalAmount: providerCapturedAmount,
}

test("provider reconciliation before learner cancellation compensates captured payment once", async () => {
  const db = await createCancellationTestDatabase()

  try {
    // Given: provider success captured 9,000 while local reservation/payment rows still say 10,001.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    await setReconciliationServiceRole(db)
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: providerDonePayload,
    })
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: providerDonePayload,
    })
    await setAuthenticatedUser(db, ids.learner)

    // When: the learner cancellation and its exact retry run after provider evidence exists.
    const first = await cancelReservation(db, "Provider confirmation needs reconciliation")
    const repeated = await cancelReservation(db, "Provider confirmation needs reconciliation")
    await db.exec("reset role")
    const approval = await db.query("select approved_at from public.payments")
    const audits = await db.query(`
      select action, count(*)::integer as count
      from public.audit_logs
      group by action
      order by action
    `)

    // Then: captured money remains paid and one full compensating refund is requested.
    assert.equal(first.reservation_status, "cancelled_by_user")
    assert.deepEqual(repeated, first)
    assert.ok(approval.rows[0].approved_at instanceof Date)
    assert.deepEqual(audits.rows, [
      { action: "payment.confirmation_reconciliation_required", count: 1 },
      { action: "reservation.cancelled", count: 1 },
    ])
    assert.deepEqual(await readCancelledReconciliationState(db), {
      approved: true,
      failed_reason: "confirmation_reconciliation_required:P0007",
      payment_status: "paid",
      provider_payment_key: providerPaymentKey,
      raw_payload: providerDonePayload,
      reconciliation_audit_count: 1,
      refund_amount: providerCapturedAmount,
      refund_count: 1,
      refund_reason: "Provider payment confirmed before reservation cancellation.",
      refund_requested_by: ids.learner,
      refund_source: "payment_confirmation_reconciliation",
      refund_status: "requested",
      reservation_status: "cancelled_by_user",
      reserved_count: 0,
    })
  } finally {
    await db.close()
  }
})

test("learner cancellation before provider reconciliation compensates captured payment once", async () => {
  const db = await createCancellationTestDatabase()

  try {
    // Given: the learner cancellation wins before the verified 9,000 provider success reaches Postgres.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    await setAuthenticatedUser(db, ids.learner)
    await cancelReservation(db, "Provider confirmation raced cancellation")
    await setReconciliationServiceRole(db)

    // When: provider reconciliation and its exact retry resume after cancellation.
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: providerDonePayload,
    })
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: providerDonePayload,
    })
    await db.exec("reset role")

    // Then: compensation is exactly the provider-captured amount, not the stale stored amount.
    assert.deepEqual(await readCancelledReconciliationState(db), {
      approved: true,
      failed_reason: "confirmation_reconciliation_required:P0007",
      payment_status: "paid",
      provider_payment_key: providerPaymentKey,
      raw_payload: providerDonePayload,
      reconciliation_audit_count: 1,
      refund_amount: providerCapturedAmount,
      refund_count: 1,
      refund_reason: "Provider payment confirmed after reservation cancellation.",
      refund_requested_by: ids.learner,
      refund_source: "payment_confirmation_reconciliation",
      refund_status: "requested",
      reservation_status: "cancelled_by_user",
      reserved_count: 0,
    })
  } finally {
    await db.close()
  }
})

test("reconciliation compensation conflict rolls cancellation back atomically", async () => {
  const db = await createCancellationTestDatabase()

  try {
    // Given: 9,000 provider evidence and a conflicting compensating refund already exist.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    await setReconciliationServiceRole(db)
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: providerDonePayload,
    })
    await db.exec("reset role")
    await db.query(
      `insert into public.refunds
        (payment_id, reservation_id, requested_by, amount, reason, source)
       values ($1, $2, $3, 1, 'conflict fixture', 'payment_confirmation_reconciliation')`,
      [ids.payment, ids.reservation, ids.learner],
    )
    await setAuthenticatedUser(db, ids.learner)

    // When: cancellation cannot create its required full compensating refund.
    await assert.rejects(
      () => cancelReservation(db, "Provider confirmation needs reconciliation"),
      (error) => error.code === "23505",
    )
    await db.exec("reset role")

    // Then: payment and reservation transitions roll back with all cancellation side effects.
    const result = await db.query(`
      select r.status as reservation_status, p.status as payment_status,
        p.provider_payment_key, p.amount as payment_amount, p.approved_at is not null as approved,
        (select count(*)::integer from public.refunds) as refund_count,
        (select count(*)::integer from public.audit_logs) as audit_count,
        (select count(*)::integer from public.notifications) as notification_count
      from public.reservations r
      join public.payments p on p.reservation_id = r.id
    `)
    assert.deepEqual(result.rows[0], {
      approved: true,
      audit_count: 1,
      notification_count: 0,
      payment_amount: providerCapturedAmount,
      payment_status: "ready",
      provider_payment_key: providerPaymentKey,
      refund_count: 1,
      reservation_status: "pending_payment",
    })
  } finally {
    await db.close()
  }
})

for (const scenario of [
  { name: "missing amount", rawPayload: { status: "DONE" } },
  { name: "non-numeric amount", rawPayload: { status: "DONE", totalAmount: "9000" } },
  { name: "fractional amount", rawPayload: { status: "DONE", totalAmount: 9000.5 } },
]) {
  test(`provider reconciliation rejects ${scenario.name} before state changes`, async () => {
    await assertMalformedProviderEvidenceRejected(scenario.rawPayload)
  })
}

test("provider reconciliation rejects contradictory retry before state changes", async () => {
  const db = await createCancellationTestDatabase()

  try {
    // Given: the first verified provider evidence has already made 9,000 authoritative.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    await setReconciliationServiceRole(db)
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: providerDonePayload,
    })

    // When: the same provider key is retried with contradictory captured money.
    await assert.rejects(
      () =>
        markPaymentConfirmationReconciliationRequired(db, {
          amount: 8000,
          failureCode: "P0007",
          rawPayload: { ...providerDonePayload, totalAmount: 8000 },
        }),
      (error) => error.code === "P0007",
    )
    await db.exec("rollback")
    await db.exec("reset role")

    // Then: the original provider-captured amount and single audit remain unchanged.
    const result = await db.query(`
      select p.status as payment_status, p.provider_payment_key, p.amount as payment_amount,
        p.approved_at is not null as approved, p.failed_reason, p.raw_payload,
        (select count(*)::integer from public.refunds) as refund_count,
        (select count(*)::integer from public.audit_logs) as audit_count
      from public.payments p
    `)
    assert.deepEqual(result.rows[0], {
      approved: true,
      audit_count: 1,
      failed_reason: "confirmation_reconciliation_required:P0007",
      payment_amount: providerCapturedAmount,
      payment_status: "ready",
      provider_payment_key: providerPaymentKey,
      raw_payload: providerDonePayload,
      refund_count: 0,
    })
  } finally {
    await db.close()
  }
})

for (const reservationState of reconciliationReservationStates) {
  for (const scenario of contradictoryEvidenceScenarios) {
    test(`provider reconciliation rejects ${scenario.name} ${reservationState}`, async () => {
      await assertContradictoryEvidenceRetryRejected(reservationState, scenario)
    })
  }
}
