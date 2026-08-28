import assert from "node:assert/strict"
import test from "node:test"
import {
  learnerId,
  listSnapshot,
  now,
  paymentSnapshot,
  reservationSnapshot,
} from "./reservation-read-model.fixtures.mjs"
import {
  canContinueReservationPayment,
  getReservationStatusPresentation,
  normalizeReservationFilter,
  normalizeReservationPage,
  RESERVATIONS_PER_PAGE,
  readReservationListData,
  reservationStatusesForFilter,
} from "./reservation-read-runtime.mjs"

test("reservation filters and pages normalize to supported server values", () => {
  assert.equal(normalizeReservationFilter("pending"), "pending")
  assert.equal(normalizeReservationFilter("cancelled"), "cancelled")
  assert.equal(normalizeReservationFilter("unknown"), "all")
  assert.equal(normalizeReservationFilter(["confirmed"]), "all")
  assert.equal(normalizeReservationFilter(undefined), "all")
  assert.equal(normalizeReservationPage("2"), 2)
  assert.equal(normalizeReservationPage("0"), 1)
  assert.equal(normalizeReservationPage("2.5"), 1)
  assert.equal(normalizeReservationPage(["2"]), 1)
  assert.equal(RESERVATIONS_PER_PAGE, 20)
  assert.deepEqual(reservationStatusesForFilter("all"), null)
  assert.deepEqual(reservationStatusesForFilter("cancelled"), [
    "cancelled_by_user",
    "cancelled_by_coach",
    "cancelled_by_admin",
  ])
  assert.deepEqual(reservationStatusesForFilter("no_show"), ["no_show_user", "no_show_coach"])
})

test("every reservation state has a concise Korean label and semantic badge tone", () => {
  const expected = {
    cancelled_by_admin: ["관리자 취소", "neutral"],
    cancelled_by_coach: ["지도자 취소", "warning"],
    cancelled_by_user: ["학습자 취소", "neutral"],
    completed: ["수업 완료", "success"],
    confirmed: ["예약 확정", "success"],
    disputed: ["분쟁 중", "error"],
    no_show_coach: ["지도자 노쇼", "warning"],
    no_show_user: ["학습자 노쇼", "warning"],
    pending_payment: ["결제 대기", "warning"],
  }
  for (const [status, [label, tone]] of Object.entries(expected)) {
    assert.deepEqual(getReservationStatusPresentation(status), { label, tone })
  }
})

test("payment continuation matches payment page pending, expiry, and ready Toss semantics", () => {
  const reservation = reservationSnapshot()
  assert.equal(canContinueReservationPayment(reservation, null, now), true)
  assert.equal(
    canContinueReservationPayment(reservation, paymentSnapshot({ status: "ready" }), now),
    true,
  )
  assert.equal(
    canContinueReservationPayment(
      reservation,
      paymentSnapshot({ provider: "other", status: "ready" }),
      now,
    ),
    false,
  )
  for (const status of ["paid", "failed", "cancelled", "partially_refunded", "refunded"]) {
    assert.equal(
      canContinueReservationPayment(reservation, paymentSnapshot({ status }), now),
      false,
    )
  }
  assert.equal(
    canContinueReservationPayment(
      reservationSnapshot({ paymentExpiresAt: "2026-08-01T00:00:00.000Z" }),
      null,
      now,
    ),
    false,
  )
  assert.equal(
    canContinueReservationPayment(reservationSnapshot({ status: "confirmed" }), null, now),
    false,
  )
})

test("list reader passes learner scope and returns display-safe ready and empty states", async () => {
  const calls = []
  const ready = await readReservationListData(
    learnerId,
    "pending",
    2,
    async (...args) => {
      calls.push(args)
      return listSnapshot()
    },
    now,
  )
  assert.deepEqual(calls, [[learnerId, "pending", 2]])
  assert.equal(ready.state, "ready")
  assert.equal(ready.viewModel.items[0].canContinuePayment, true)
  assert.equal(ready.viewModel.items[0].lessonTitle, "입문 테니스 레슨")
  assert.equal(ready.viewModel.items[0].paymentSummary, "결제 준비됨")
  assert.equal(ready.viewModel.items[0].refundSummary, "환불 35,000원 · 요청됨")
  assert.equal(ready.viewModel.totalPages, 3)
  assert.doesNotMatch(
    JSON.stringify(ready),
    /learnerId|learner_id|provider|raw_payload|payment_key/u,
  )

  const empty = await readReservationListData(
    learnerId,
    "all",
    1,
    async () => listSnapshot({ reservations: [], totalCount: 0 }),
    now,
  )
  assert.equal(empty.state, "empty")
  assert.deepEqual(empty.viewModel.items, [])
})

test("list reader explains expired pending and refunded rows without duplicate wording", async () => {
  const expired = await readReservationListData(
    learnerId,
    "pending",
    1,
    async () =>
      listSnapshot({
        payments: [],
        refunds: [],
        reservations: [reservationSnapshot({ paymentExpiresAt: "2026-07-31T23:59:00.000Z" })],
        totalCount: 1,
      }),
    now,
  )
  const refunded = await readReservationListData(
    learnerId,
    "cancelled",
    1,
    async () =>
      listSnapshot({
        payments: [paymentSnapshot({ status: "refunded" })],
        refunds: [{ amount: 7_000, reservationId: reservationSnapshot().id, status: "completed" }],
        reservations: [reservationSnapshot({ status: "cancelled_by_user" })],
        totalCount: 1,
      }),
    now,
  )
  assert.equal(expired.viewModel.items[0].paymentSummary, "결제 기한 만료")
  assert.equal(refunded.viewModel.items[0].paymentSummary, "결제 처리됨")
  assert.equal(refunded.viewModel.items[0].refundSummary, "환불 7,000원 · 완료")
})
