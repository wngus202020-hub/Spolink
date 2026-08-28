import assert from "node:assert/strict"
import test from "node:test"

import { assertCounts, assertRaceStateSnapshot, canonicalizeRaceState } from "./state.mjs"

test("baseline preserves exact duplicate-sensitive fields and counts", () => {
  const state = raceState()

  assertRaceStateSnapshot(state, expectedState())
  assertCounts(state, {
    cancelAudits: 2,
    cancelNotifications: 2,
    cancellationRefunds: 2,
  })
})

test("tied rows canonicalize identically when input order is reversed", () => {
  const snapshots = new Set()

  for (let permutation = 0; permutation < 8; permutation += 1) {
    const state = raceState()
    if (permutation & 1) state.audits.reverse()
    if (permutation & 2) state.notifications.reverse()
    if (permutation & 4) state.refunds.reverse()
    assertRaceStateSnapshot(state, expectedState())
    snapshots.add(JSON.stringify(canonicalizeRaceState(state)))
  }

  assert.equal(snapshots.size, 1)
})

test("notification user_id changes the canonical snapshot", () => {
  const original = canonicalizeRaceState(raceState())
  const changedState = raceState()
  changedState.notifications[0].user_id = "user-c"

  assert.notDeepEqual(canonicalizeRaceState(changedState), original)
})

test("tied notifications from different users canonicalize across input permutations", () => {
  const state = raceState()
  state.notifications[0].status = "cancelled_by_user"
  const reversed = raceState()
  reversed.notifications[0].status = "cancelled_by_user"
  reversed.notifications.reverse()
  const expected = [
    { status: "cancelled_by_user", type: "reservation_cancelled", user_id: "user-a" },
    { status: "cancelled_by_user", type: "reservation_cancelled", user_id: "user-b" },
  ]

  assert.deepEqual(canonicalizeRaceState(state).notifications, expected)
  assert.deepEqual(canonicalizeRaceState(reversed).notifications, expected)
})

test("semantic duplicate, actor, target, payload, and count mutations are rejected", () => {
  const mutations = [
    (state) => state.notifications.pop(),
    (state) => state.notifications.push({ ...state.notifications[0] }),
    (state) => {
      state.notifications[0].user_id = "user-c"
    },
    (state) => {
      state.audits[0].target_id = "payment-b"
    },
    (state) => {
      state.payment.raw_payload.status = "CANCELED"
    },
    (state) => {
      state.reserved_count = 1
    },
  ]

  for (const mutate of mutations) {
    const state = raceState()
    mutate(state)
    assert.throws(() => assertRaceStateSnapshot(state, expectedState()))
  }
})

function raceState() {
  return {
    audits: [
      {
        action: "reservation.cancelled",
        refund_amount: 7000,
        refund_source: null,
        target_id: "reservation-a",
        target_type: "reservation",
      },
      {
        action: "reservation.cancelled",
        refund_amount: null,
        refund_source: null,
        target_id: "reservation-b",
        target_type: "reservation",
      },
    ],
    notifications: [
      { status: "cancelled_by_admin", type: "reservation_cancelled", user_id: "user-b" },
      { status: "cancelled_by_user", type: "reservation_cancelled", user_id: "user-a" },
    ],
    payment: {
      amount: 10001,
      raw_payload: { status: "DONE", totalAmount: 10001 },
      status: "paid",
    },
    refunds: [
      {
        amount: 7000,
        reason: "reason-a",
        source: "reservation_cancellation",
        status: "requested",
      },
      {
        amount: 7000,
        reason: "reason-b",
        source: "reservation_cancellation",
        status: "requested",
      },
    ],
    reservation: { status: "cancelled_by_user" },
    reserved_count: 0,
  }
}

function expectedState() {
  return {
    audits: [
      {
        action: "reservation.cancelled",
        refund_amount: 7000,
        refund_source: null,
        target_id: "reservation-a",
        target_type: "reservation",
      },
      {
        action: "reservation.cancelled",
        refund_amount: null,
        refund_source: null,
        target_id: "reservation-b",
        target_type: "reservation",
      },
    ],
    notifications: [
      { status: "cancelled_by_admin", type: "reservation_cancelled", user_id: "user-b" },
      { status: "cancelled_by_user", type: "reservation_cancelled", user_id: "user-a" },
    ],
    payment: {
      amount: 10001,
      raw_payload: { status: "DONE", totalAmount: 10001 },
      status: "paid",
    },
    refunds: [
      {
        amount: 7000,
        reason: "reason-a",
        source: "reservation_cancellation",
        status: "requested",
      },
      {
        amount: 7000,
        reason: "reason-b",
        source: "reservation_cancellation",
        status: "requested",
      },
    ],
    reservation: { status: "cancelled_by_user" },
    reserved_count: 0,
  }
}
