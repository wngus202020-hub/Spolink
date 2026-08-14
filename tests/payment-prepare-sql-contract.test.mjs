import assert from "node:assert/strict"
import test from "node:test"

import {
  extractRowLockSequence,
  readPaymentFunction,
} from "./payment-lock-order-sql-test-helpers.mjs"
import { createPaymentTestDatabase } from "./payment-prepare-sql-test-database.mjs"
import {
  insertedPaymentId,
  learnerId,
  otherLearnerId,
  reservationId,
  seededPaymentId,
  seedPayment,
  seedProfile,
  seedReadyReservation,
} from "./payment-prepare-sql-test-fixtures.mjs"
import {
  assertPaymentRpcError,
  createReadyPayment,
  setAuthenticatedUser,
} from "./payment-prepare-sql-test-rpc.mjs"
import { readStoredPaymentCount, readStoredPayments } from "./payment-prepare-sql-test-state.mjs"

test("create_ready_payment locks reservation before payment", async () => {
  const functionSql = await readPaymentFunction("create_ready_payment")

  assert.deepEqual(extractRowLockSequence(functionSql), ["reservations", "payments"])
})

test("create_ready_payment inserts a ready Toss payment for the authenticated learner", async () => {
  const db = await createPaymentTestDatabase()

  try {
    await seedReadyReservation(db)
    await setAuthenticatedUser(db, learnerId)

    const payment = await createReadyPayment(db, reservationId)

    assert.deepEqual(payment, {
      amount: 50000,
      order_name: "입문 테니스 레슨",
      payment_id: insertedPaymentId,
      provider: "toss",
      provider_order_id: `spolink_${reservationId}`,
    })

    const storedPayments = await readStoredPayments(db)
    assert.deepEqual(storedPayments, [
      {
        amount: 50000,
        payer_id: learnerId,
        provider: "toss",
        provider_order_id: `spolink_${reservationId}`,
        reservation_id: reservationId,
        status: "ready",
      },
    ])
  } finally {
    await db.close()
  }
})

test("create_ready_payment is idempotent for an existing ready payment", async () => {
  const db = await createPaymentTestDatabase()

  try {
    await seedReadyReservation(db)
    await seedPayment(db, "ready")
    await setAuthenticatedUser(db, learnerId)

    const payment = await createReadyPayment(db, reservationId)

    assert.equal(payment.payment_id, seededPaymentId)
    assert.equal(payment.provider_order_id, `spolink_${reservationId}`)

    const storedPaymentCount = await readStoredPaymentCount(db)
    assert.deepEqual(storedPaymentCount, [{ count: 1 }])
  } finally {
    await db.close()
  }
})

test("create_ready_payment rejects expired, non-owner, and non-ready reservation states", async () => {
  const expiredDb = await createPaymentTestDatabase()
  try {
    await seedReadyReservation(expiredDb, { paymentExpiresAt: "now() - interval '1 minute'" })
    await setAuthenticatedUser(expiredDb, learnerId)
    await assertPaymentRpcError(expiredDb, "P0005")
  } finally {
    await expiredDb.close()
  }

  const nonOwnerDb = await createPaymentTestDatabase()
  try {
    await seedReadyReservation(nonOwnerDb)
    await seedProfile(nonOwnerDb, otherLearnerId, "learner")
    await setAuthenticatedUser(nonOwnerDb, otherLearnerId)
    await assertPaymentRpcError(nonOwnerDb, "P0002")
  } finally {
    await nonOwnerDb.close()
  }

  const confirmedDb = await createPaymentTestDatabase()
  try {
    await seedReadyReservation(confirmedDb, { status: "confirmed" })
    await setAuthenticatedUser(confirmedDb, learnerId)
    await assertPaymentRpcError(confirmedDb, "23505")
  } finally {
    await confirmedDb.close()
  }
})

test("create_ready_payment rejects unauthenticated, non-learner, and non-ready existing payments", async () => {
  const unauthenticatedDb = await createPaymentTestDatabase()
  try {
    await seedReadyReservation(unauthenticatedDb)
    await assertPaymentRpcError(unauthenticatedDb, "42501")
  } finally {
    await unauthenticatedDb.close()
  }

  const coachDb = await createPaymentTestDatabase()
  try {
    await seedReadyReservation(coachDb)
    await seedProfile(coachDb, otherLearnerId, "coach")
    await setAuthenticatedUser(coachDb, otherLearnerId)
    await assertPaymentRpcError(coachDb, "42501")
  } finally {
    await coachDb.close()
  }

  const paidPaymentDb = await createPaymentTestDatabase()
  try {
    await seedReadyReservation(paidPaymentDb)
    await seedPayment(paidPaymentDb, "paid")
    await setAuthenticatedUser(paidPaymentDb, learnerId)
    await assertPaymentRpcError(paidPaymentDb, "23505")
  } finally {
    await paidPaymentDb.close()
  }
})
