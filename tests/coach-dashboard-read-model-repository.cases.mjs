import assert from "node:assert/strict"
import test from "node:test"
import { dashboardRows, expectedDashboard } from "./coach-dashboard-read-model.fixtures.mjs"
import {
  CoachDashboardReadError,
  createDashboardClient,
  now,
  readCoachDashboard,
} from "./coach-dashboard-read-model.harness.mjs"

test("review notification and settlement queries return exact secure summaries", async () => {
  const actual = await readCoachDashboard({
    client: createDashboardClient(dashboardRows),
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })
  assert.deepEqual(actual.recentReviews, expectedDashboard.recentReviews)
  assert.deepEqual(actual.notifications, expectedDashboard.notifications)
  assert.deepEqual(actual.pendingSettlements, expectedDashboard.pendingSettlements)
})

test("successful zero rows return exact empty and zero dashboard values", async () => {
  const emptyRows = Object.fromEntries(Object.keys(dashboardRows).map((table) => [table, []]))
  const actual = await readCoachDashboard({
    client: createDashboardClient(emptyRows),
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })
  assert.deepEqual(actual, {
    notifications: { items: [], unreadCount: 0 },
    pendingSettlements: { count: 0, totalNetAmount: 0 },
    recentReviews: [],
    reservations: {
      completionPending: 0,
      confirmed: 0,
      labels: { confirmed: "예약 확정", pending_payment: "결제 대기" },
      pendingPayment: 0,
    },
    todaySchedules: [],
  })
})

test("starts all five independent reads concurrently after owned lessons resolve", async () => {
  const client = createDashboardClient(dashboardRows, null, true)
  const resultPromise = readCoachDashboard({
    client,
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })

  await client.waitForConcurrentQueries()
  assert.deepEqual(
    client.calls.map((call) => call.table),
    ["lessons", "lesson_schedules", "reservations", "settlements", "reviews", "notifications"],
  )
  client.releaseAll()
  await assert.doesNotReject(resultPromise)
})

test("each dashboard query failure throws the typed whole-read failure", async (t) => {
  for (const table of Object.keys(dashboardRows)) {
    await t.test(table, async () => {
      await assert.rejects(
        readCoachDashboard({
          client: createDashboardClient(dashboardRows, table),
          coachProfileId: "coach-owned",
          now,
          profileId: "profile-owned",
        }),
        (error) => {
          assert.ok(error instanceof CoachDashboardReadError)
          assert.equal(error.code, "COACH_DASHBOARD_READ_FAILED")
          assert.doesNotMatch(error.message, /PRIVATE|sensitive/u)
          return true
        },
      )
    })
  }
})
