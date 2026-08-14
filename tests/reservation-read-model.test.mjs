import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  canContinueReservationPayment,
  getReservationStatusPresentation,
  normalizeReservationFilter,
  normalizeReservationPage,
  RESERVATIONS_PER_PAGE,
  readReservationDetailData,
  readReservationListData,
  reservationStatusesForFilter,
} from "../lib/reservations/read-model.ts"

const learnerId = "00000000-0000-4000-8000-000000000001"
const reservationId = "00000000-0000-4000-8000-000000000401"
const now = new Date("2026-08-01T00:00:00.000Z")

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
      status,
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
        refunds: [{ amount: 7_000, reservationId, status: "completed" }],
        reservations: [reservationSnapshot({ status: "cancelled_by_user" })],
        totalCount: 1,
      }),
    now,
  )

  assert.equal(expired.viewModel.items[0].paymentSummary, "결제 기한 만료")
  assert.equal(refunded.viewModel.items[0].paymentSummary, "결제 처리됨")
  assert.equal(refunded.viewModel.items[0].refundSummary, "환불 7,000원 · 완료")
})

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

test("detail cancellation estimates use stored amount and exact 24h and 3h boundaries", async () => {
  const seventyPercent = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => detailSnapshot({ scheduleStartsAt: "2026-08-02T00:00:00.000Z" }),
    now,
  )
  const fiftyPercent = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => detailSnapshot({ scheduleStartsAt: "2026-08-01T03:00:00.000Z" }),
    now,
  )
  const pending = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => detailSnapshot({ reservationStatus: "pending_payment" }),
    now,
  )
  const completed = await readReservationDetailData(
    reservationId,
    learnerId,
    async () => detailSnapshot({ reservationStatus: "completed" }),
    now,
  )

  assert.equal(seventyPercent.viewModel.cancellation.estimatedRefundAmount, 35_000)
  assert.equal(fiftyPercent.viewModel.cancellation.estimatedRefundAmount, 25_000)
  assert.equal(pending.viewModel.cancellation.estimatedRefundAmount, 0)
  assert.equal(pending.viewModel.cancellation.availableByStatus, true)
  assert.equal(completed.viewModel.cancellation.availableByStatus, false)
  assert.equal(completed.viewModel.cancellation.estimatedRefundAmount, null)
})

test("actual readers establish session ownership before service enrichment and batch safe fields", async () => {
  const source = await readFile(
    new URL("../lib/reservations/read-model.ts", import.meta.url),
    "utf8",
  )
  const listReader = source.slice(
    source.indexOf("export async function readReservationListSnapshot"),
    source.indexOf("export async function readReservationDetailSnapshot"),
  )
  const detailReader = source.slice(
    source.indexOf("export async function readReservationDetailSnapshot"),
    source.indexOf("function mapReservationSnapshot"),
  )
  const enrichment = source.slice(source.indexOf("async function enrichOwnedReservations"))

  assert.ok(listReader.indexOf('.eq("learner_id", learnerId)') >= 0)
  assert.ok(
    listReader.indexOf("reservations.length === 0") < listReader.indexOf("enrichOwnedReservations"),
  )
  assert.ok(detailReader.indexOf('.eq("learner_id", learnerId)') >= 0)
  assert.ok(
    detailReader.indexOf("if (!reservationResult.data)") <
      detailReader.indexOf("enrichOwnedReservations"),
  )
  assert.match(enrichment, /createSupabaseServiceClient\(\)/u)
  assert.match(enrichment, /\.in\("id", lessonIds\)/u)
  assert.match(enrichment, /\.in\("id", scheduleIds\)/u)
  assert.match(enrichment, /\.in\("reservation_id", reservationIds\)/u)
  assert.match(enrichment, /\.eq\("payer_id", learnerId\)/u)
  assert.doesNotMatch(enrichment, /provider_payment_key|provider_refund_key|raw_payload/u)
})

function listSnapshot(overrides = {}) {
  return {
    coaches: [{ displayName: "김코치", id: "coach-1" }],
    kind: "found",
    lessons: [lessonSnapshot()],
    payments: [paymentSnapshot()],
    refunds: [{ amount: 35_000, reservationId, status: "requested" }],
    reservations: [reservationSnapshot()],
    schedules: [scheduleSnapshot()],
    totalCount: 41,
    ...overrides,
  }
}

function detailSnapshot(overrides = {}) {
  const reservationStatus = overrides.reservationStatus ?? "confirmed"
  return {
    coaches: [{ displayName: "김코치", id: "coach-1" }],
    kind: "found",
    lessons: [lessonSnapshot()],
    payments: [paymentSnapshot({ status: reservationStatus === "confirmed" ? "paid" : "ready" })],
    refunds: [],
    reservation: reservationSnapshot({ status: reservationStatus }),
    schedules: [scheduleSnapshot({ startsAt: overrides.scheduleStartsAt })],
  }
}

function reservationSnapshot(overrides = {}) {
  return {
    coachProfileId: "coach-1",
    createdAt: "2026-07-30T00:00:00.000Z",
    id: reservationId,
    lessonId: "lesson-1",
    lessonScheduleId: "schedule-1",
    paymentExpiresAt: "2026-08-01T00:10:00.000Z",
    reservedPriceAmount: 50_000,
    status: "pending_payment",
    ...overrides,
  }
}

function lessonSnapshot() {
  return {
    address: "서울 강남구 테헤란로 1",
    cancellationPolicySummary: "수업 24시간 전까지 70% 환불",
    coachProfileId: "coach-1",
    id: "lesson-1",
    placeName: "강남 테니스장",
    region: "서울 강남구",
    title: "입문 테니스 레슨",
  }
}

function scheduleSnapshot(overrides = {}) {
  return {
    endsAt: "2026-08-03T02:00:00.000Z",
    id: "schedule-1",
    startsAt: "2026-08-03T01:00:00.000Z",
    ...overrides,
  }
}

function paymentSnapshot(overrides = {}) {
  return {
    amount: 50_000,
    provider: "toss",
    reservationId,
    status: "ready",
    ...overrides,
  }
}
