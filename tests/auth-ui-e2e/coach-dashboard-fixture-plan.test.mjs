import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

import { defaultCoachDashboardEpoch } from "./coach-dashboard-runner-core.mjs"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/coach-dashboard-fixture-catalog")) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { buildCoachDashboardFixturePlan } = await import("./coach-dashboard-fixture-plan.ts")
const epoch = "2026-08-29T03:00:00.000Z"

test("default epoch rolls over at the exact KST midnight boundary", () => {
  assert.equal(
    defaultCoachDashboardEpoch(new Date("2026-08-29T14:59:59.999Z")),
    "2026-08-29T03:00:00.000Z",
  )
  assert.equal(
    defaultCoachDashboardEpoch(new Date("2026-08-29T15:00:00.000Z")),
    "2026-08-30T03:00:00.000Z",
  )
  assert.throws(() => defaultCoachDashboardEpoch(new Date(Number.NaN)), /valid runner clock/u)
})

test("fixture plan is deterministic around the explicitly supplied epoch", () => {
  const first = buildCoachDashboardFixturePlan(epoch)
  const second = buildCoachDashboardFixturePlan(epoch)

  assert.deepEqual(first, second)
  assert.equal(first.epoch, epoch)
  assert.deepEqual(
    first.personas.map(({ alias, accountState, coachState }) => ({
      accountState,
      alias,
      coachState,
    })),
    [
      { accountState: "coach_approved", alias: "approved-owner", coachState: "approved" },
      { accountState: "coach_approved", alias: "empty-coach", coachState: "approved" },
      { accountState: "coach_approved", alias: "foreign-coach", coachState: "approved" },
      { accountState: "active", alias: "profile-required", coachState: null },
      { accountState: "active", alias: "active-learner", coachState: null },
      { accountState: "active", alias: "applicant-draft", coachState: "draft" },
      { accountState: "pending_coach", alias: "applicant-submitted", coachState: "submitted" },
      { accountState: "active", alias: "applicant-rejected", coachState: "rejected" },
      { accountState: "suspended", alias: "restricted-suspended", coachState: null },
      { accountState: "deleted", alias: "restricted-deleted", coachState: null },
      { accountState: "active", alias: "learner-reviewer", coachState: null },
    ],
  )
  assert.equal(first.personas.filter((persona) => persona.alias !== "profile-required").length, 10)
  assert.equal(first.personas.filter((persona) => persona.coachState !== null).length, 6)
  assert.notDeepEqual(buildCoachDashboardFixturePlan("2026-08-30T03:00:00.000Z"), first)
})

test("fixture plan names every populated and ownership exclusion category", () => {
  const plan = buildCoachDashboardFixturePlan(epoch)

  assert.deepEqual(
    plan.graph.schedules.map((row) => row.alias),
    [
      "owner-day-start",
      "owner-closed",
      "owner-zero-reservations",
      "owner-confirmed-two",
      "owner-confirmed-three",
      "owner-day-end-excluded",
      "foreign-visible",
    ],
  )
  assert.deepEqual(
    plan.graph.reviews.map((row) => `${row.owner}:${row.status}:${row.alias}`),
    [
      "approved-owner:visible:owner-visible-latest-1",
      "approved-owner:visible:owner-visible-latest-2",
      "approved-owner:visible:owner-visible-latest-3",
      "approved-owner:visible:owner-visible-old-excluded",
      "approved-owner:hidden:owner-hidden-excluded",
      "approved-owner:deleted:owner-deleted-excluded",
      "foreign-coach:visible:foreign-visible",
    ],
  )
  assert.deepEqual(
    plan.graph.notifications.map((row) => `${row.owner}:${row.read}:${row.alias}`),
    [
      "approved-owner:false:owner-unread-latest-1",
      "approved-owner:false:owner-unread-latest-2",
      "approved-owner:false:owner-unread-latest-3",
      "approved-owner:false:owner-unread-old-counted",
      "approved-owner:true:owner-read-excluded",
      "foreign-coach:false:foreign-unread",
    ],
  )
  assert.deepEqual(
    plan.graph.settlements.map((row) => `${row.owner}:${row.status}:${row.netAmount}`),
    [
      "approved-owner:pending:8500",
      "approved-owner:pending:17000",
      "approved-owner:hold:7000",
      "foreign-coach:pending:99000",
    ],
  )
})
