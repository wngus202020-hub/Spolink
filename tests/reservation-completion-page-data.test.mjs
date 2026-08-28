import assert from "node:assert/strict"
import test from "node:test"
import {
  completionSnapshot,
  completionView,
  expectedState,
  learnerId,
  now,
  paymentStatuses,
  rawCompletionFields,
  reservationId,
  reservationStatuses,
} from "./reservation-completion-page-data.fixtures.mjs"
import {
  classifyReservationCompletionState,
  readReservationCompletionPageData,
} from "./reservation-read-runtime.mjs"

test("Given an owned confirmed and paid reservation, when completion data is read, then it is complete with raw calendar-safe fields", async () => {
  // Given
  const calls = []

  // When
  const result = await readReservationCompletionPageData(
    reservationId,
    learnerId,
    async (...args) => {
      calls.push(args)
      return completionSnapshot({ paymentStatus: "paid", reservationStatus: "confirmed" })
    },
    now,
  )

  // Then
  assert.deepEqual(calls, [[reservationId, learnerId]])
  assert.equal(result.state, "complete")
  assert.deepEqual(rawCompletionFields(result.viewModel), {
    endsAt: "2026-08-03T02:00:00.000Z",
    lessonId: "00000000-0000-4000-8000-000000000101",
    paymentStatus: "paid",
    preparation: "테니스화와 물을 준비해 주세요.",
    reservationStatus: "confirmed",
    startsAt: "2026-08-03T01:00:00.000Z",
  })
  assert.equal(result.viewModel.lessonTitle, "입문 테니스 레슨")
  assert.equal(result.viewModel.paymentSummary, "결제 완료")
})

test("Given a pending reservation with a valid expiry, when it has no payment or a ready Toss payment, then it stays pending", async () => {
  for (const paymentStatus of [null, "ready"]) {
    // Given
    const calls = []

    // When
    const result = await readReservationCompletionPageData(
      reservationId,
      learnerId,
      async (...args) => {
        calls.push(args)
        return completionSnapshot({ paymentStatus, reservationStatus: "pending_payment" })
      },
      now,
    )

    // Then
    assert.equal(result.state, "pending", String(paymentStatus))
    assert.deepEqual(calls, [[reservationId, learnerId]], String(paymentStatus))
  }
})

test("Given every reservation and payment state pair, when completion state is classified, then only strict raw-state transitions are allowed", async () => {
  let reads = 0
  for (const reservationStatus of reservationStatuses) {
    for (const paymentStatus of paymentStatuses) {
      // When
      const result = await readReservationCompletionPageData(
        reservationId,
        learnerId,
        async () => {
          reads += 1
          return completionSnapshot({ paymentStatus, reservationStatus })
        },
        now,
      )

      // Then
      assert.equal(result.state, expectedState(reservationStatus, paymentStatus))
    }
  }
  assert.equal(reads, reservationStatuses.length * paymentStatuses.length)
})

test("Given invalid pending payment inputs, when completion state is classified, then it is a mismatch", async () => {
  for (const snapshot of [
    completionSnapshot({
      paymentProvider: "other",
      paymentStatus: "ready",
      reservationStatus: "pending_payment",
    }),
    completionSnapshot({
      paymentExpiresAt: "2026-08-01T00:00:00.000Z",
      paymentStatus: null,
      reservationStatus: "pending_payment",
    }),
  ]) {
    const result = await readReservationCompletionPageData(
      reservationId,
      learnerId,
      async () => snapshot,
      now,
    )
    assert.equal(result.state, "mismatch")
  }
})

test("Given misleading presentation text, when raw fields are classified, then text cannot create completion", () => {
  assert.equal(
    classifyReservationCompletionState(
      completionView({ paymentStatus: "ready", reservationStatus: "confirmed" }),
      now,
    ),
    "mismatch",
  )
  assert.equal(classifyReservationCompletionState(completionView(), now), "complete")
})

test("Given malformed, foreign, missing, or failed reads, when completion data is read, then it is safe and non-identifying", async () => {
  let malformedCalls = 0
  const malformed = await readReservationCompletionPageData(
    "not-a-uuid",
    learnerId,
    async () => {
      malformedCalls += 1
      return completionSnapshot()
    },
    now,
  )
  const foreign = await readReservationCompletionPageData(
    reservationId,
    learnerId,
    async () => ({ kind: "not_found" }),
    now,
  )
  const thrown = await readReservationCompletionPageData(
    reservationId,
    learnerId,
    async () => {
      throw new Error("read failed")
    },
    now,
  )
  const explicitFailure = await readReservationCompletionPageData(
    reservationId,
    learnerId,
    async () => ({ kind: "read_failure" }),
    now,
  )

  assert.equal(malformedCalls, 0)
  assert.deepEqual(malformed, { state: "not_found", viewModel: null })
  assert.deepEqual(foreign, { state: "not_found", viewModel: null })
  assert.deepEqual(thrown, { state: "read_failure", viewModel: null })
  assert.deepEqual(explicitFailure, { state: "read_failure", viewModel: null })
})
