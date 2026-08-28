import assert from "node:assert/strict"
import test from "node:test"

import {
  AdminDashboardReadError,
  readAdminDashboardCounts,
} from "../lib/admin/dashboard-read-model.ts"

const queues = [
  ["coach_profiles", "coachApplications"],
  ["lessons", "lessonReviews"],
  ["reports", "openReports"],
  ["reservations", "disputedReservations"],
  ["settlements", "heldSettlements"],
]

function successfulOutcomes(counts = [0, 1, 2, 3, 4]) {
  return Object.fromEntries(
    queues.map(([table], index) => [table, { count: counts[index], error: null }]),
  )
}

function createClient(outcomes, waitForRelease = false) {
  const calls = []
  const pending = []

  function resultFor(table) {
    const outcome = outcomes[table]
    assert.ok(outcome, `missing outcome for ${table}`)
    if (!waitForRelease) return Promise.resolve(outcome)
    return new Promise((resolve) => pending.push(() => resolve(outcome)))
  }

  return {
    calls,
    from(table) {
      return {
        select(columns, options) {
          const call = { columns, options, predicate: null, table }
          calls.push(call)
          return {
            eq(column, value) {
              call.predicate = { kind: "eq", column, value }
              return resultFor(table)
            },
            in(column, values) {
              call.predicate = { kind: "in", column, values: [...values] }
              return resultFor(table)
            },
          }
        },
      }
    },
    releaseAll() {
      for (const release of pending) release()
    },
  }
}

test("maps five admin queue counts with exact count-only filters", async () => {
  const client = createClient(successfulOutcomes())

  const result = await readAdminDashboardCounts(client)

  assert.deepEqual(result, {
    coachApplications: 0,
    lessonReviews: 1,
    openReports: 2,
    disputedReservations: 3,
    heldSettlements: 4,
  })
  assert.deepEqual(client.calls, [
    {
      table: "coach_profiles",
      columns: "id",
      options: { count: "exact", head: true },
      predicate: { kind: "eq", column: "status", value: "submitted" },
    },
    {
      table: "lessons",
      columns: "id",
      options: { count: "exact", head: true },
      predicate: { kind: "eq", column: "status", value: "pending_review" },
    },
    {
      table: "reports",
      columns: "id",
      options: { count: "exact", head: true },
      predicate: {
        kind: "in",
        column: "status",
        values: ["submitted", "reviewing"],
      },
    },
    {
      table: "reservations",
      columns: "id",
      options: { count: "exact", head: true },
      predicate: { kind: "eq", column: "status", value: "disputed" },
    },
    {
      table: "settlements",
      columns: "id",
      options: { count: "exact", head: true },
      predicate: { kind: "eq", column: "status", value: "hold" },
    },
  ])
})

test("starts all five count queries before any query settles", async () => {
  const client = createClient(successfulOutcomes(), true)

  const resultPromise = readAdminDashboardCounts(client)

  assert.equal(client.calls.length, 5)
  client.releaseAll()
  await assert.doesNotReject(resultPromise)
})

test("query failure rejects without exposing query details or partial counts", async (t) => {
  for (const [failedTable] of queues) {
    await t.test(`${failedTable} error`, async () => {
      const outcomes = successfulOutcomes()
      outcomes[failedTable] = {
        count: null,
        error: { code: "PRIVATE_CODE", message: "sensitive query detail" },
      }

      await assert.rejects(readAdminDashboardCounts(createClient(outcomes)), (error) => {
        assert.ok(error instanceof AdminDashboardReadError)
        assert.equal(error.code, "ADMIN_DASHBOARD_READ_FAILED")
        assert.equal(error.message, "관리자 대시보드 건수를 불러오지 못했습니다.")
        assert.doesNotMatch(error.message, /PRIVATE_CODE|sensitive/u)
        return true
      })
    })

    await t.test(`${failedTable} null count`, async () => {
      const outcomes = successfulOutcomes()
      outcomes[failedTable] = { count: null, error: null }

      await assert.rejects(
        readAdminDashboardCounts(createClient(outcomes)),
        AdminDashboardReadError,
      )
    })
  }
})
