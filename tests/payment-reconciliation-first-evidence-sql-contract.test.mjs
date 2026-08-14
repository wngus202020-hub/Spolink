import test from "node:test"

import {
  assertFirstProviderEvidenceRejected,
  firstCallIdentityCases,
  firstEvidenceReservationStates,
  outOfRangeAmountCases,
  providerPayloadWithAmount,
} from "./payment-reconciliation-first-evidence-test-helpers.mjs"

for (const reservationState of firstEvidenceReservationStates) {
  for (const scenario of firstCallIdentityCases) {
    test(`provider reconciliation rejects first-call ${scenario.name} ${reservationState}`, async () => {
      await assertFirstProviderEvidenceRejected(reservationState, scenario.rawPayload)
    })
  }

  for (const scenario of outOfRangeAmountCases) {
    test(`provider reconciliation maps ${scenario.name} to P0007 ${reservationState}`, async () => {
      await assertFirstProviderEvidenceRejected(
        reservationState,
        providerPayloadWithAmount(scenario.totalAmount),
      )
    })
  }
}
