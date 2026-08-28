import assert from "node:assert/strict"
import test from "node:test"

import {
  foundSnapshot,
  learnerId,
  now,
  paymentSnapshot,
  reservationId,
} from "./payment-page-data-fixtures.mjs"
import { installPaymentPageModuleResolver } from "./payment-page-module-resolver.mjs"

installPaymentPageModuleResolver()

const { classifyPaymentPageState, readPaymentPageData } = await import(
  "../lib/payments/payment-page-data.ts"
)

test("payment page classifier covers pending, ready, confirmed, terminal, and unavailable states", () => {
  assert.equal(classifyPaymentPageState(foundSnapshot(), now), "pending_valid")
  assert.equal(
    classifyPaymentPageState(
      foundSnapshot({ reservation: { paymentExpiresAt: "2026-08-01T00:00:00.000Z" } }),
      now,
    ),
    "expired_pending",
  )
  assert.equal(
    classifyPaymentPageState(foundSnapshot({ payment: paymentSnapshot() }), now),
    "ready",
  )
  assert.equal(
    classifyPaymentPageState(
      foundSnapshot({
        payment: paymentSnapshot({ status: "paid" }),
        reservation: { status: "confirmed" },
      }),
      now,
    ),
    "confirmed",
  )

  for (const status of [
    "cancelled_by_user",
    "cancelled_by_coach",
    "cancelled_by_admin",
    "completed",
    "no_show_user",
    "no_show_coach",
    "disputed",
  ]) {
    assert.equal(
      classifyPaymentPageState(foundSnapshot({ reservation: { status } }), now),
      "terminal",
    )
  }

  assert.equal(
    classifyPaymentPageState(foundSnapshot({ reservation: { paymentExpiresAt: null } }), now),
    "unavailable",
  )
  assert.equal(
    classifyPaymentPageState(
      foundSnapshot({ payment: paymentSnapshot({ provider: "other" }) }),
      now,
    ),
    "unavailable",
  )
})

test("payment page classifier gives expiration precedence over an existing ready payment", () => {
  const snapshot = foundSnapshot({
    payment: paymentSnapshot(),
    reservation: { paymentExpiresAt: "2026-07-31T23:59:59.999Z" },
  })

  assert.equal(classifyPaymentPageState(snapshot, now), "expired_pending")
})

test("payment page classifier preserves not-found and read-failure states", () => {
  assert.equal(classifyPaymentPageState({ kind: "not_found" }, now), "not_found")
  assert.equal(classifyPaymentPageState({ kind: "read_failure" }, now), "read_failure")
})

test("Given inconsistent confirmation pairs, when payment state is classified, then only confirmed and paid is confirmed", () => {
  // Given
  const strictSuccess = foundSnapshot({
    payment: paymentSnapshot({ status: "paid" }),
    reservation: { status: "confirmed" },
  })
  const inconsistentPairs = [
    foundSnapshot({ reservation: { status: "confirmed" } }),
    foundSnapshot({
      payment: paymentSnapshot(),
      reservation: { status: "confirmed" },
    }),
    foundSnapshot({
      payment: paymentSnapshot({ status: "failed" }),
      reservation: { status: "confirmed" },
    }),
    foundSnapshot({ payment: paymentSnapshot({ status: "paid" }) }),
  ]

  // When / Then
  assert.equal(classifyPaymentPageState(strictSuccess, now), "confirmed")
  for (const snapshot of inconsistentPairs) {
    assert.equal(classifyPaymentPageState(snapshot, now), "unavailable")
  }
})

test("payment page reader passes reservation and learner ids and returns display-safe ready data", async () => {
  const calls = []
  const snapshot = foundSnapshot({ payment: paymentSnapshot() })
  const result = await readPaymentPageData(
    reservationId,
    learnerId,
    async (targetReservationId, targetLearnerId) => {
      calls.push([targetReservationId, targetLearnerId])
      return snapshot
    },
    now,
  )

  assert.deepEqual(calls, [[reservationId, learnerId]])
  assert.equal(result.state, "ready")
  assert.deepEqual(result.viewModel, {
    amount: 50_000,
    lesson: {
      id: "00000000-0000-4000-8000-000000000101",
      title: "입문 테니스 레슨",
    },
    paymentExpiresAt: "2026-08-01T00:10:00.000Z",
    place: "강남 테니스장",
    readyPayment: {
      amount: 50_000,
      orderName: "입문 테니스 레슨",
      paymentId: "00000000-0000-4000-8000-000000000501",
      provider: "toss",
      providerOrderId: `spolink_${reservationId}`,
    },
    refundSummary: "수업 24시간 전까지 70% 환불",
    region: "서울 강남구",
    reservation: { id: reservationId, status: "pending_payment" },
    schedule: {
      endsAt: "2026-08-03T02:00:00.000Z",
      label: "2026. 8. 3. 오전 10:00 - 2026. 8. 3. 오전 11:00",
      startsAt: "2026-08-03T01:00:00.000Z",
    },
  })
  assert.equal("learnerId" in result.viewModel.reservation, false)
})

test("payment page reader returns no model for not-found and converts thrown reads to failures", async () => {
  const notFound = await readPaymentPageData(
    reservationId,
    learnerId,
    async () => ({ kind: "not_found" }),
    now,
  )
  const failed = await readPaymentPageData(
    reservationId,
    learnerId,
    async () => {
      throw new Error("database unavailable")
    },
    now,
  )

  assert.deepEqual(notFound, { state: "not_found", viewModel: null })
  assert.deepEqual(failed, { state: "read_failure", viewModel: null })
})

test("payment page reader suppresses ready identifiers outside the ready state", async () => {
  const expired = await readPaymentPageData(
    reservationId,
    learnerId,
    async () =>
      foundSnapshot({
        payment: paymentSnapshot(),
        reservation: { paymentExpiresAt: "2026-08-01T00:00:00.000Z" },
      }),
    now,
  )
  const terminal = await readPaymentPageData(
    reservationId,
    learnerId,
    async () =>
      foundSnapshot({
        payment: paymentSnapshot(),
        reservation: { status: "cancelled_by_user" },
      }),
    now,
  )

  assert.equal(expired.state, "expired_pending")
  assert.equal(expired.viewModel.readyPayment, null)
  assert.equal(terminal.state, "terminal")
  assert.equal(terminal.viewModel.readyPayment, null)
})
