import assert from "node:assert/strict"
import test from "node:test"
import {
  assertConfirmProviderEvidenceError,
  confirmPaidReservationWithPayload,
  invalidConfirmProviderPayloadCases,
  readConfirmProviderEvidenceState,
  validConfirmProviderPayload,
} from "./payment-confirm-provider-evidence-helpers.mjs"
import {
  createConfirmTestDatabase,
  seedReadyPayment,
  setServiceRole,
} from "./payment-confirm-sql-test-helpers.mjs"

test("confirm_paid_reservation rejects malformed provider evidence before mutation", async () => {
  for (const [name, rawPayload] of invalidConfirmProviderPayloadCases) {
    await test(name, async () => {
      const db = await createConfirmTestDatabase()

      try {
        await seedReadyPayment(db)
        await setServiceRole(db)
        const before = await readConfirmProviderEvidenceState(db)

        await assertConfirmProviderEvidenceError(db, rawPayload)

        assert.deepEqual(await readConfirmProviderEvidenceState(db), before)
      } finally {
        await db.close()
      }
    })
  }
})

test("confirm_paid_reservation stores complete provider evidence and retries exactly", async () => {
  const db = await createConfirmTestDatabase()

  try {
    await seedReadyPayment(db)
    await setServiceRole(db)

    await confirmPaidReservationWithPayload(db, validConfirmProviderPayload)
    const paidState = await readConfirmProviderEvidenceState(db)

    assert.equal(paidState.payment.raw_payload.totalAmount, 50000)
    assert.deepEqual(paidState.payment.raw_payload, validConfirmProviderPayload)

    await confirmPaidReservationWithPayload(db, validConfirmProviderPayload)

    assert.deepEqual(await readConfirmProviderEvidenceState(db), paidState)
  } finally {
    await db.close()
  }
})

test("confirm_paid_reservation rejects contradictory paid retries without mutation", async () => {
  for (const [name, rawPayload] of [
    ["contradictory paid retry", { ...validConfirmProviderPayload, totalAmount: 40000 }],
    ["incomplete paid retry", { status: "DONE" }],
  ]) {
    await test(name, async () => {
      const db = await createConfirmTestDatabase()

      try {
        await seedReadyPayment(db)
        await setServiceRole(db)
        await confirmPaidReservationWithPayload(db, validConfirmProviderPayload)
        const paidState = await readConfirmProviderEvidenceState(db)

        await assertConfirmProviderEvidenceError(db, rawPayload)

        assert.deepEqual(await readConfirmProviderEvidenceState(db), paidState)
      } finally {
        await db.close()
      }
    })
  }
})
