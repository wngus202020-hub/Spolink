import assert from "node:assert/strict"
import test from "node:test"
import {
  dashboardRows,
  expectedDashboard,
  expectedTrace,
} from "./coach-dashboard-read-model.fixtures.mjs"
import {
  CoachDashboardReadError,
  createDashboardClient,
  now,
  readCoachDashboard,
} from "./coach-dashboard-read-model.harness.mjs"

test("manual secure dashboard JSON returns exact redacted data and query trace", async () => {
  const client = createDashboardClient(dashboardRows)
  const actual = await readCoachDashboard({
    client,
    coachProfileId: "coach-owned",
    now,
    profileId: "profile-owned",
  })

  assert.deepEqual(actual, expectedDashboard)
  assert.deepEqual(client.calls, expectedTrace)
  assert.doesNotMatch(
    JSON.stringify(actual),
    /review-|notification-|profile-|learner|hidden|rawPayload|gross_amount|coach_profile_id/u,
  )
  console.log(
    `MANUAL_SECURE_DASHBOARD_JSON ${JSON.stringify({ data: actual, trace: client.calls })}`,
  )
})

test("malformed row timestamps and amounts throw the typed read error", async (t) => {
  const malformedCases = [
    [
      "schedule timestamp",
      "lesson_schedules",
      { ...dashboardRows.lesson_schedules[0], ends_at: "invalid" },
    ],
    ["review timestamp", "reviews", { ...dashboardRows.reviews[0], created_at: "invalid" }],
    [
      "notification timestamp",
      "notifications",
      { ...dashboardRows.notifications[0], created_at: "invalid" },
    ],
    ["settlement amount", "settlements", { ...dashboardRows.settlements[0], net_amount: "12000" }],
  ]
  for (const [name, table, malformed] of malformedCases) {
    await t.test(name, async () => {
      const rows = { ...dashboardRows, [table]: [malformed, ...dashboardRows[table].slice(1)] }
      await assert.rejects(
        readCoachDashboard({
          client: createDashboardClient(rows),
          coachProfileId: "coach-owned",
          now,
          profileId: "profile-owned",
        }),
        CoachDashboardReadError,
      )
    })
  }
})
