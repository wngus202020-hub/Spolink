import assert from "node:assert/strict"
import test from "node:test"
import {
  detailSnapshot,
  learnerId,
  legacyDetailProjection,
  lessonSnapshot,
  now,
  reservationId,
} from "./reservation-read-model.fixtures.mjs"
import { readReservationDetailData } from "./reservation-read-runtime.mjs"

test("detail reader makes missing and foreign-equivalent snapshots indistinguishable", async () => {
  const notFound = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => ({ kind: "not_found" }),
    now,
  )
  const thrown = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => {
      throw new Error("database unavailable")
    },
    now,
  )
  const failed = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => ({ kind: "read_failure" }),
    now,
  )
  assert.deepEqual(notFound, { state: "not_found", viewModel: null })
  assert.deepEqual(thrown, { state: "read_failure", viewModel: null })
  assert.deepEqual(failed, { state: "read_failure", viewModel: null })
})

test("detail reader preserves the current owned found presentation contract", async () => {
  const result = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => detailSnapshot(),
    now,
  )
  assert.deepEqual(legacyDetailProjection(result), {
    state: "ready",
    viewModel: {
      amountText: "50,000원",
      canContinuePayment: false,
      cancellation: {
        availableByStatus: true,
        estimatedRefundAmount: null,
        estimatedRefundText: "일정 정보가 없어 예상 환불액을 계산할 수 없어요.",
        storedPolicySummary: "수업 24시간 전까지 70% 환불",
      },
      coachName: "김코치",
      id: reservationId,
      lessonTitle: "입문 테니스 레슨",
      location: "서울 강남구 · 강남 테니스장",
      paymentSummary: "결제 완료",
      refundSummary: null,
      scheduleLabel: "일정 정보 확인 필요",
      status: { label: "예약 확정", tone: "success" },
    },
  })
})

test("detail reader maps nullable raw payment, schedule, and preparation fields for completion decisions", async () => {
  const snapshot = detailSnapshot()
  snapshot.lessons = [lessonSnapshot({ preparation: null })]
  snapshot.payments = []
  snapshot.schedules = []
  const result = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => snapshot,
    now,
  )
  assert.equal(result.viewModel.reservationStatus, "confirmed")
  assert.equal(result.viewModel.paymentStatus, null)
  assert.equal(result.viewModel.lessonId, "lesson-1")
  assert.equal(result.viewModel.startsAt, null)
  assert.equal(result.viewModel.endsAt, null)
  assert.equal(result.viewModel.preparation, null)
})

test("detail cancellation estimates use stored amount and exact 24h and 3h boundaries", async () => {
  const read = (overrides) =>
    readReservationDetailData(reservationId, learnerId, async () => detailSnapshot(overrides), now)
  const seventyPercent = await read({ scheduleStartsAt: "2026-08-02T00:00:00.000Z" })
  const fiftyPercent = await read({ scheduleStartsAt: "2026-08-01T03:00:00.000Z" })
  const pending = await read({ reservationStatus: "pending_payment" })
  const completed = await read({ reservationStatus: "completed" })
  assert.equal(seventyPercent.viewModel.cancellation.estimatedRefundAmount, 35_000)
  assert.equal(fiftyPercent.viewModel.cancellation.estimatedRefundAmount, 25_000)
  assert.equal(pending.viewModel.cancellation.estimatedRefundAmount, 0)
  assert.equal(pending.viewModel.cancellation.availableByStatus, true)
  assert.equal(completed.viewModel.cancellation.availableByStatus, false)
  assert.equal(completed.viewModel.cancellation.estimatedRefundAmount, null)
})
