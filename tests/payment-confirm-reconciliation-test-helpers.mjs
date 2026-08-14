import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { readReconciliationIntegritySnapshot } from "./payment-confirm-reconciliation-observables.mjs"
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

const migrationPath = new URL(
  "../supabase/migrations/20260712000000_mvp_schema.sql",
  import.meta.url,
)
const providerCapturedAmount = 9000
const providerOrderId = `spolink_${ids.reservation}`
const completeProviderDonePayload = {
  approvedAt: "2026-07-15T09:00:00+09:00",
  orderId: providerOrderId,
  paymentKey: providerPaymentKey,
  status: "DONE",
  totalAmount: providerCapturedAmount,
}

export const reconciliationReservationStates = ["before cancellation", "after refund"]
export const contradictoryEvidenceScenarios = [
  {
    name: "independent key and amount replacement",
    options: {
      amount: 8000,
      failureCode: "P0007",
      paymentKey: "different-payment-key",
      rawPayload: {
        ...completeProviderDonePayload,
        paymentKey: "different-payment-key",
        totalAmount: 8000,
      },
    },
  },
  {
    name: "provider key replacement",
    options: {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      paymentKey: "different-payment-key",
      rawPayload: { ...completeProviderDonePayload, paymentKey: "different-payment-key" },
    },
  },
  {
    name: "captured amount replacement",
    options: {
      amount: 8000,
      failureCode: "P0007",
      rawPayload: { ...completeProviderDonePayload, totalAmount: 8000 },
    },
  },
  {
    name: "provider order argument replacement",
    options: {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      orderId: "spolink_different-order",
      rawPayload: { ...completeProviderDonePayload, orderId: "spolink_different-order" },
    },
  },
  {
    name: "DONE payload order identity replacement",
    options: {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: { ...completeProviderDonePayload, orderId: "spolink_different-order" },
    },
  },
  {
    name: "failure code replacement",
    options: {
      amount: providerCapturedAmount,
      failureCode: "P0003",
      rawPayload: completeProviderDonePayload,
    },
  },
  {
    name: "DONE payload approval evidence replacement",
    options: {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: { ...completeProviderDonePayload, approvedAt: "2026-07-15T10:00:00+09:00" },
    },
  },
  {
    clearStoredApproval: true,
    name: "missing stored approval evidence",
    options: {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: completeProviderDonePayload,
    },
  },
]

export async function loadPaymentReconciliationFunction(db) {
  const migration = await readFile(migrationPath, "utf8")
  const start = migration.indexOf(
    "create or replace function public.mark_payment_confirmation_reconciliation_required",
  )
  const grantStart = migration.indexOf(
    "grant execute on function public.mark_payment_confirmation_reconciliation_required",
    start,
  )
  const end = migration.indexOf(";", grantStart)

  assert.notEqual(start, -1)
  assert.notEqual(grantStart, -1)
  assert.notEqual(end, -1)
  await db.exec(migration.slice(start, end + 1))
}

export async function setReconciliationServiceRole(db) {
  await db.exec(`
    reset role;
    set request.jwt.claim.sub = '';
    set request.jwt.claim.role = 'service_role';
    set role service_role;
  `)
}

export async function assertContradictoryEvidenceRetryRejected(reservationState, scenario) {
  const db = await createCancellationTestDatabase()

  try {
    // Given: payment-key/9,000 provider evidence is authoritative in this ordering.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    if (reservationState === "after refund") {
      await setAuthenticatedUser(db, ids.learner)
      await cancelReservation(db, "Provider confirmation raced cancellation")
    }
    await setReconciliationServiceRole(db)
    await markPaymentConfirmationReconciliationRequired(db, {
      amount: providerCapturedAmount,
      failureCode: "P0007",
      rawPayload: completeProviderDonePayload,
    })
    if (scenario.clearStoredApproval) {
      await db.exec("reset role")
      await db.exec("update public.payments set approved_at = null")
    }
    const before = await readReconciliationIntegritySnapshot(db)
    await setReconciliationServiceRole(db)

    // When: one dimension of the accepted provider evidence contradicts its retry.
    let errorCode = null
    try {
      await markPaymentConfirmationReconciliationRequired(db, scenario.options)
    } catch (error) {
      errorCode = error.code
      await db.exec("rollback")
    }
    const after = await readReconciliationIntegritySnapshot(db)

    // Then: P0007 rejects it and every related persisted field is identical.
    assert.deepEqual({ after, errorCode }, { after: before, errorCode: "P0007" })
  } finally {
    await db.close()
  }
}

export async function assertMalformedProviderEvidenceRejected(rawPayload) {
  const db = await createCancellationTestDatabase()

  try {
    // Given: stale local money exists and provider evidence lacks a whole captured amount.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    await setReconciliationServiceRole(db)

    // When: reconciliation receives malformed provider evidence.
    await assert.rejects(
      () =>
        markPaymentConfirmationReconciliationRequired(db, {
          failureCode: "P0007",
          rawPayload,
        }),
      (error) => error.code === "P0007",
    )
    await db.exec("rollback")
    await db.exec("reset role")

    // Then: no partial provider, audit, or refund state is persisted.
    const result = await db.query(`
      select p.status as payment_status, p.provider_payment_key, p.amount as payment_amount,
        p.approved_at is not null as approved, p.failed_reason, p.raw_payload,
        (select count(*)::integer from public.refunds) as refund_count,
        (select count(*)::integer from public.audit_logs) as audit_count
      from public.payments p
    `)
    assert.deepEqual(result.rows[0], {
      approved: false,
      audit_count: 0,
      failed_reason: null,
      payment_amount: 10001,
      payment_status: "ready",
      provider_payment_key: null,
      raw_payload: null,
      refund_count: 0,
    })
  } finally {
    await db.close()
  }
}
