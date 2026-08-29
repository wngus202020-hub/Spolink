import assert from "node:assert/strict"
import test from "node:test"

import {
  CoachDashboardReadError,
  getKstDayWindow,
  now,
  schedule,
  summarizeCoachReservations,
  summarizeCoachSchedules,
} from "./coach-dashboard-read-model.harness.mjs"

test("KST day window uses exact half-open UTC boundaries", () => {
  assert.deepEqual(getKstDayWindow(now), {
    endExclusive: "2026-08-29T15:00:00.000Z",
    start: "2026-08-28T15:00:00.000Z",
  })
})

test("schedule summary includes boundary, closed, zero, and full owned schedules", () => {
  const rows = Object.freeze([
    schedule("start", "2026-08-28T15:00:00.000Z"),
    schedule("closed", "2026-08-28T16:00:00.000Z", { is_open: false }),
    schedule("zero", "2026-08-28T17:00:00.000Z", { reserved_count: 0 }),
    schedule("full", "2026-08-28T18:00:00.000Z", { capacity: 2, reserved_count: 2 }),
    schedule("next-midnight", "2026-08-29T15:00:00.000Z"),
    schedule("foreign", "2026-08-28T19:00:00.000Z", { lesson_id: "lesson-foreign" }),
  ])

  const result = summarizeCoachSchedules(rows, Object.freeze(["lesson-owned"]), now)

  assert.deepEqual(
    result.map((row) => row.id),
    ["start", "closed", "zero", "full"],
  )
})
test("schedule summary has a stable timestamp and id order and limits output to eight", () => {
  const rows = Object.freeze([
    schedule("id-09", "2026-08-29T01:00:00.000Z"),
    schedule("id-02", "2026-08-28T16:00:00.000Z"),
    schedule("id-01", "2026-08-28T16:00:00.000Z"),
    schedule("id-08", "2026-08-29T00:00:00.000Z"),
    schedule("id-07", "2026-08-28T23:00:00.000Z"),
    schedule("id-06", "2026-08-28T22:00:00.000Z"),
    schedule("id-05", "2026-08-28T21:00:00.000Z"),
    schedule("id-04", "2026-08-28T20:00:00.000Z"),
    schedule("id-03", "2026-08-28T19:00:00.000Z"),
  ])

  const result = summarizeCoachSchedules(rows, Object.freeze(["lesson-owned"]), now)

  assert.deepEqual(
    result.map((row) => row.id),
    ["id-01", "id-02", "id-03", "id-04", "id-05", "id-06", "id-07", "id-08"],
  )
})

test("reservation summary counts only owned pending and confirmed rows", () => {
  const rows = Object.freeze([
    Object.freeze({ coach_profile_id: "coach-owned", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_user" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_coach" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "completed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "unsupported_internal_state" }),
  ])

  assert.deepEqual(summarizeCoachReservations(rows, "coach-owned"), {
    completionPending: 2,
    confirmed: 2,
    labels: {
      confirmed: "예약 확정",
      pending_payment: "결제 대기",
    },
    pendingPayment: 1,
  })
})

test("invalid Date and malformed schedule timestamps fail with the typed read error", () => {
  assert.throws(() => getKstDayWindow(new Date("invalid")), CoachDashboardReadError)
  assert.throws(
    () =>
      summarizeCoachSchedules(
        Object.freeze([schedule("invalid", "not-a-timestamp")]),
        Object.freeze(["lesson-owned"]),
        now,
      ),
    CoachDashboardReadError,
  )
})

test("manual data JSON matches the exact KST dashboard summary", () => {
  const schedules = Object.freeze([
    schedule("schedule-09-omitted", "2026-08-29T02:00:00.000Z"),
    schedule("schedule-08", "2026-08-29T01:00:00.000Z"),
    schedule("schedule-07", "2026-08-29T00:00:00.000Z"),
    schedule("schedule-06", "2026-08-28T23:00:00.000Z"),
    schedule("schedule-05", "2026-08-28T22:00:00.000Z"),
    schedule("schedule-04-full", "2026-08-28T21:00:00.000Z", {
      capacity: 2,
      reserved_count: 2,
    }),
    schedule("schedule-03-zero", "2026-08-28T20:00:00.000Z", { reserved_count: 0 }),
    schedule("schedule-02-closed", "2026-08-28T19:00:00.000Z", { is_open: false }),
    schedule("schedule-01-boundary", "2026-08-28T15:00:00.000Z"),
    schedule("schedule-next-midnight", "2026-08-29T15:00:00.000Z"),
    schedule("schedule-foreign", "2026-08-28T18:00:00.000Z", {
      lesson_id: "lesson-foreign",
    }),
  ])
  const reservations = Object.freeze([
    Object.freeze({ coach_profile_id: "coach-owned", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "confirmed" }),
    Object.freeze({ coach_profile_id: "coach-foreign", status: "pending_payment" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "cancelled_by_user" }),
    Object.freeze({ coach_profile_id: "coach-owned", status: "completed" }),
  ])
  const window = getKstDayWindow(now)
  const actual = {
    endExclusive: window.endExclusive,
    scheduleIds: summarizeCoachSchedules(schedules, Object.freeze(["lesson-owned"]), now).map(
      (row) => row.id,
    ),
    start: window.start,
    ...summarizeCoachReservations(reservations, "coach-owned"),
  }
  const expected = {
    completionPending: 2,
    confirmed: 2,
    endExclusive: "2026-08-29T15:00:00.000Z",
    labels: {
      confirmed: "예약 확정",
      pending_payment: "결제 대기",
    },
    pendingPayment: 1,
    scheduleIds: [
      "schedule-01-boundary",
      "schedule-02-closed",
      "schedule-03-zero",
      "schedule-04-full",
      "schedule-05",
      "schedule-06",
      "schedule-07",
      "schedule-08",
    ],
    start: "2026-08-28T15:00:00.000Z",
  }

  assert.deepEqual(actual, expected)
  console.log(`MANUAL_DATA_JSON ${JSON.stringify(actual)}`)
})
