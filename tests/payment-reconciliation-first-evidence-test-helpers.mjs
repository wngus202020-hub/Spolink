import assert from "node:assert/strict"

import { readReconciliationIntegritySnapshot } from "./payment-confirm-reconciliation-observables.mjs"
import {
  loadPaymentReconciliationFunction,
  setReconciliationServiceRole,
} from "./payment-confirm-reconciliation-test-helpers.mjs"
import {
  markPaymentConfirmationReconciliationRequired,
  providerOrderId,
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
export const validProviderPayload = {
  orderId: providerOrderId,
  paymentKey: providerPaymentKey,
  status: "DONE",
  totalAmount: providerCapturedAmount,
}

export const firstEvidenceReservationStates = ["before cancellation", "after cancellation"]
export const firstCallIdentityCases = [
  {
    name: "raw order identity mismatch",
    rawPayload: { ...validProviderPayload, orderId: "spolink_different-order" },
  },
  {
    name: "raw payment identity mismatch",
    rawPayload: { ...validProviderPayload, paymentKey: "different-payment-key" },
  },
]
export const outOfRangeAmountCases = [
  { name: "int32 max plus one", totalAmount: 2147483648 },
  { name: "integer far above int32", totalAmount: 9223372036854776000 },
]

export function providerPayloadWithAmount(totalAmount) {
  return { ...validProviderPayload, totalAmount }
}

export async function observeFirstProviderEvidence(reservationState, rawPayload) {
  const db = await createCancellationTestDatabase()

  try {
    // Given: checked identifiers and stored order identity are valid with no provider evidence.
    await seedCancellationScenario(db, {
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    })
    await loadPaymentReconciliationFunction(db)
    if (reservationState === "after cancellation") {
      await setAuthenticatedUser(db, ids.learner)
      await cancelReservation(db, "Provider confirmation raced cancellation")
    }
    const before = await readReconciliationIntegritySnapshot(db)
    await setReconciliationServiceRole(db)

    // When: the first provider evidence is internally invalid.
    let errorCode = null
    try {
      await markPaymentConfirmationReconciliationRequired(db, {
        amount: providerCapturedAmount,
        failureCode: "P0007",
        rawPayload,
      })
    } catch (error) {
      errorCode = error.code
      await db.exec("rollback")
    }
    const after = await readReconciliationIntegritySnapshot(db)

    return { after, before, errorCode }
  } finally {
    await db.close()
  }
}

export async function assertFirstProviderEvidenceRejected(reservationState, rawPayload) {
  const observation = await observeFirstProviderEvidence(reservationState, rawPayload)

  // Then: the boundary returns P0007 before any six-table state change.
  assert.deepEqual(
    { after: observation.after, errorCode: observation.errorCode },
    { after: observation.before, errorCode: "P0007" },
  )
}
