import assert from "node:assert/strict"
import test from "node:test"

import * as builders from "./builders.mjs"
import { expandFixedId } from "./ids.mjs"

const epoch = new Date("2026-08-16T00:00:00.000Z")
const authIds = {
  admin: "00000000-0000-4000-8000-000000000001",
  coach: "00000000-0000-4000-8000-000000000002",
  learner: "00000000-0000-4000-8000-000000000003",
  otherLearner: "00000000-0000-4000-8000-000000000004",
  pendingCoach: "00000000-0000-4000-8000-000000000005",
}

test("fixture suffix uniqueness keeps 25h, 4h, and 2h schedules in their policy windows", () => {
  const rows = builders.buildFixtureRows({
    epoch,
    authIds,
    tennisSportId: "00000000-0000-4000-8000-000000000006",
  })

  assert.equal(policyWindow(hoursUntil(rows, "310")), "full")
  assert.equal(policyWindow(hoursUntil(rows, "311")), "partial")
  assert.equal(policyWindow(hoursUntil(rows, "312")), "none")
  assert.ok(hoursUntil(rows, "310") < 48, "25h fixture must not drift by hundreds of hours")
})

test("large suffix values do not scale semantic schedule time", () => {
  assert.equal(typeof builders.fixtureScheduleOffsetHours, "function")
  const normal = builders.fixtureScheduleOffsetHours({ startsInHours: 25, suffix: "310" }, 2)
  const large = builders.fixtureScheduleOffsetHours(
    { startsInHours: 25, suffix: "999999999999999999999999" },
    2,
  )
  assert.equal(large, normal)
  assert.ok(large <= 12, "fixture uniqueness offset must remain sub-window")
})

test("future fixture uniqueness leaves a full schedule gap after the 25h SQL boundary", () => {
  const offset = builders.fixtureScheduleOffsetHours({ startsInHours: 25, suffix: "310" }, 0)
  assert.ok(offset >= 2, "a 1h offset overlaps a separately-timestamped 25h SQL fixture")
})

test("partial and no-refund fixtures do not overlap exact SQL boundary ranges", () => {
  const rows = builders.buildFixtureRows({
    epoch,
    authIds,
    tennisSportId: "00000000-0000-4000-8000-000000000006",
  })

  assert.ok(hoursUntil(rows, "311") >= 5, "partial fixture overlaps the 3h SQL range")
  assert.ok(hoursUntil(rows, "312") <= 1, "no-refund fixture overlaps the 2h59m59s SQL range")
})

test("exact 24h and 3h policy boundaries keep their intended categories", () => {
  const fullBoundary =
    24 +
    builders.fixtureScheduleOffsetHours(
      { startsInHours: 24, suffix: "999999999999999999999999" },
      0,
    )
  const partialBoundary =
    3 +
    builders.fixtureScheduleOffsetHours({ startsInHours: 3, suffix: "999999999999999999999999" }, 0)

  assert.equal(policyWindow(fullBoundary), "full")
  assert.equal(policyWindow(partialBoundary), "partial")
})

function hoursUntil(rows, suffix) {
  const schedule = rows.schedules.find((candidate) => candidate.id === expandFixedId(suffix))
  assert.ok(schedule, `missing fixture schedule ${suffix}`)
  return (Date.parse(schedule.starts_at) - epoch.getTime()) / 3_600_000
}

function policyWindow(hours) {
  if (hours >= 24) return "full"
  if (hours >= 3) return "partial"
  return "none"
}
