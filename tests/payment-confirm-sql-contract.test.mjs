import assert from "node:assert/strict"
import test from "node:test"
import { readCancelledReconciliationState } from "./payment-confirm-reconciliation-observables.mjs"
import {
  loadPaymentReconciliationFunction,
  setReconciliationServiceRole,
} from "./payment-confirm-reconciliation-test-helpers.mjs"
import { assertConfirmError, selectOne } from "./payment-confirm-sql-assertions.mjs"
import {
  confirmPaidReservation,
  createConfirmTestDatabase,
  markPaymentConfirmationFailed,
  markPaymentConfirmationReconciliationRequired,
  providerPaymentKey,
  reservationId,
  seedReadyPayment,
  setServiceRole,
} from "./payment-confirm-sql-test-helpers.mjs"
import {
  extractRowLockSequence,
  readPaymentFunction,
} from "./payment-lock-order-sql-test-helpers.mjs"
import {
  cancelReservation,
  createCancellationTestDatabase,
  ids,
  seedCancellationScenario,
  setAuthenticatedUser,
} from "./reservation-cancel-sql-fixtures.mjs"

const paymentId = "00000000-0000-4000-8000-000000000501"

test("payment confirmation functions lock reservation before payment and schedule third", async () => {
  const functionNames = [
    "confirm_paid_reservation",
    "mark_payment_confirmation_failed",
    "mark_payment_confirmation_reconciliation_required",
  ]
  const actualLockSequences = {}

  for (const functionName of functionNames) {
    const functionSql = await readPaymentFunction(functionName)
    actualLockSequences[functionName] = extractRowLockSequence(functionSql)
  }

  assert.deepEqual(actualLockSequences, {
    confirm_paid_reservation: ["reservations", "payments", "lesson_schedules"],
    mark_payment_confirmation_failed: ["reservations", "payments"],
    mark_payment_confirmation_reconciliation_required: ["reservations", "payments"],
  })
})

test("confirm_paid_reservation marks payment paid and reservation confirmed", async () => {
  const db = await createConfirmTestDatabase()

  try {
    await seedReadyPayment(db)
    await setServiceRole(db)

    const payment = await confirmPaidReservation(db)

    assert.deepEqual(payment, {
      payment_id: paymentId,
      reservation_id: reservationId,
    })

    assert.deepEqual(
      await selectOne(db, "select status, provider_payment_key, amount from public.payments"),
      {
        amount: 50000,
        provider_payment_key: providerPaymentKey,
        status: "paid",
      },
    )
    assert.deepEqual(
      await selectOne(
        db,
        "select status, payment_expires_at is null as expires_cleared from public.reservations",
      ),
      {
        expires_cleared: true,
        status: "confirmed",
      },
    )
    assert.deepEqual(await selectOne(db, "select reserved_count from public.lesson_schedules"), {
      reserved_count: 1,
    })
    assert.deepEqual(await selectOne(db, "select type, title from public.notifications"), {
      title: "예약이 확정되었어요",
      type: "reservation_confirmed",
    })
    assert.deepEqual(await selectOne(db, "select action, target_type from public.audit_logs"), {
      action: "payment.confirmed",
      target_type: "payment",
    })
  } finally {
    await db.close()
  }
})

test("confirm_paid_reservation returns the same paid payment without incrementing capacity", async () => {
  const db = await createConfirmTestDatabase()

  try {
    await seedReadyPayment(db)
    await setServiceRole(db)
    await confirmPaidReservation(db)
    await confirmPaidReservation(db)

    assert.deepEqual(await selectOne(db, "select reserved_count from public.lesson_schedules"), {
      reserved_count: 1,
    })
  } finally {
    await db.close()
  }
})

test("confirm_paid_reservation rejects amount, expiration, and capacity failures", async () => {
  const missingPaymentDb = await createConfirmTestDatabase()
  try {
    await setServiceRole(missingPaymentDb)
    await assertConfirmError(missingPaymentDb, "P0002")
  } finally {
    await missingPaymentDb.close()
  }

  const nonReadyPaymentDb = await createConfirmTestDatabase()
  try {
    await seedReadyPayment(nonReadyPaymentDb)
    await nonReadyPaymentDb.exec("update public.payments set status = 'failed'")
    await setServiceRole(nonReadyPaymentDb)
    await assertConfirmError(nonReadyPaymentDb, "23505")
  } finally {
    await nonReadyPaymentDb.close()
  }

  const amountMismatchDb = await createConfirmTestDatabase()
  try {
    await seedReadyPayment(amountMismatchDb)
    await setServiceRole(amountMismatchDb)
    await assertConfirmError(amountMismatchDb, "P0007", { amount: 40000 })
  } finally {
    await amountMismatchDb.close()
  }

  const expiredDb = await createConfirmTestDatabase()
  try {
    await seedReadyPayment(expiredDb, { paymentExpiresAt: "now() - interval '1 minute'" })
    await setServiceRole(expiredDb)
    await assertConfirmError(expiredDb, "P0005")
  } finally {
    await expiredDb.close()
  }

  const fullScheduleDb = await createConfirmTestDatabase()
  try {
    await seedReadyPayment(fullScheduleDb, { reservedCount: 1 })
    await setServiceRole(fullScheduleDb)
    await assertConfirmError(fullScheduleDb, "P0003")
  } finally {
    await fullScheduleDb.close()
  }
})

test("mark_payment_confirmation_failed records failed payment without confirming reservation", async () => {
  const db = await createConfirmTestDatabase()

  try {
    await seedReadyPayment(db)
    await setServiceRole(db)
    await markPaymentConfirmationFailed(db)

    assert.deepEqual(await selectOne(db, "select status, failed_reason from public.payments"), {
      failed_reason: "verification_failed",
      status: "failed",
    })
    assert.deepEqual(await selectOne(db, "select status from public.reservations"), {
      status: "pending_payment",
    })
    assert.deepEqual(await selectOne(db, "select reserved_count from public.lesson_schedules"), {
      reserved_count: 0,
    })
    assert.deepEqual(await selectOne(db, "select action from public.audit_logs"), {
      action: "payment.confirmation_failed",
    })
  } finally {
    await db.close()
  }
})

test("mark_payment_confirmation_reconciliation_required preserves paid provider evidence for review", async () => {
  const db = await createConfirmTestDatabase()

  try {
    await seedReadyPayment(db)
    await setServiceRole(db)
    await markPaymentConfirmationReconciliationRequired(db)

    assert.deepEqual(
      await selectOne(
        db,
        "select status, provider_payment_key, failed_reason from public.payments",
      ),
      {
        failed_reason: "confirmation_reconciliation_required:P0003",
        provider_payment_key: providerPaymentKey,
        status: "ready",
      },
    )
    assert.deepEqual(await selectOne(db, "select status from public.reservations"), {
      status: "pending_payment",
    })
    assert.deepEqual(await selectOne(db, "select action from public.audit_logs"), {
      action: "payment.confirmation_reconciliation_required",
    })
  } finally {
    await db.close()
  }
})

test("mark_payment_confirmation_reconciliation_required compensates provider success after cancellation once", async () => {
  const db = await createCancellationTestDatabase()

  try {
    // Given: learner cancellation won before the verified provider confirmation reached Postgres.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    await setAuthenticatedUser(db, ids.learner)
    await cancelReservation(db, "Payment confirmation raced cancellation")
    await setReconciliationServiceRole(db)

    // When: the provider-success reconciliation is retried with the same evidence.
    await markPaymentConfirmationReconciliationRequired(db)
    await markPaymentConfirmationReconciliationRequired(db)
    await db.exec("reset role")

    // Then: captured money is retained as paid and compensated exactly once without capacity use.
    assert.deepEqual(await readCancelledReconciliationState(db), {
      approved: true,
      failed_reason: "confirmation_reconciliation_required:P0003",
      payment_status: "paid",
      provider_payment_key: providerPaymentKey,
      raw_payload: {
        orderId: `spolink_${ids.reservation}`,
        paymentKey: providerPaymentKey,
        status: "DONE",
        totalAmount: 10001,
      },
      reconciliation_audit_count: 1,
      refund_amount: 10001,
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
