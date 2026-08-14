import assert from "node:assert/strict"
import test from "node:test"

import { createPersonaClients, signInPersonas, signOutPersonas } from "./auth-rls/clients.mjs"
import {
  createObserver,
  readBaselineSnapshot,
  readCancellationObserverState,
  restoreCancellableBaseline,
  restoreDirectWriteBaselines,
} from "./auth-rls/observer.mjs"
import { ensureAuthGatewayReady, provisionWithAuthReadiness } from "./auth-rls/runtime.mjs"
import { assertSelectCell } from "./auth-rls/select-matrix.mjs"
import {
  assertSnapshotRejectsRepresentativeMutations,
  expectedSelectSnapshot,
} from "./auth-rls/snapshots.mjs"
import {
  assertPaymentRefundWriteDenied,
  assertReservationWriteCell,
  assertScheduleOrdinaryWriteCell,
  assertScheduleReservedCountCell,
} from "./auth-rls/writes.mjs"
import { fixedIds } from "./fixtures.mjs"

let provision
let clients
let observer
let baseline

test.before(async () => {
  await ensureAuthGatewayReady()
  provision = await provisionWithAuthReadiness()
  clients = createPersonaClients(provision.status)
  await signInPersonas(clients, provision.runPassword)
  observer = createObserver(provision.status)
  baseline = await readBaselineSnapshot(observer)
})

test.after(async () => {
  if (observer && baseline) {
    await restoreCancellableBaseline(observer, baseline)
    await restoreDirectWriteBaselines(observer, baseline)
    await observer.end({ timeout: 1 })
  }
  if (clients) await signOutPersonas(clients)
  if (provision) await provision.cleanup()
})

test("SELECT anonymous: no reservation, public-open schedule, payments/refunds permission-denied", async () => {
  await assertSelectCell({
    name: "SELECT anonymous",
    client: clients.anonymous,
    expected: expectedSelectSnapshot({
      persona: "anonymous",
      authIds: provision.authIds,
      epoch: provision.epoch,
    }),
  })
})

for (const cell of [
  ["learner", "SELECT learner"],
  ["otherLearner", "SELECT unrelated learner"],
  ["coach", "SELECT approved owning coach"],
  ["pendingCoach", "SELECT pending coach"],
  ["admin", "SELECT admin"],
]) {
  const [persona, name] = cell
  test(`${name}: exact baseline visibility matrix`, async () => {
    await assertSelectCell({
      name,
      client: clients[persona],
      expected: expectedSelectSnapshot({
        persona,
        authIds: provision.authIds,
        epoch: provision.epoch,
      }),
    })
  })
}

test("mutation probe: SELECT snapshot oracle rejects representative field drift", () => {
  assertSnapshotRejectsRepresentativeMutations({
    authIds: provision.authIds,
    epoch: provision.epoch,
  })
})

test("direct mutation matrix: reservation writes are admin-only", async () => {
  try {
    for (const persona of ["learner", "otherLearner", "coach", "pendingCoach"]) {
      await assertReservationWriteCell({
        name: `direct mutation ${persona} reservation denied`,
        client: clients[persona],
        allowed: false,
      })
    }
    assert.deepEqual(await readBaselineSnapshot(observer), baseline)
    await assertReservationWriteCell({
      name: "direct mutation admin reservation allowed",
      client: clients.admin,
      allowed: true,
    })
  } finally {
    await restoreDirectWriteBaselines(observer, baseline)
  }
})

test("direct mutation matrix: payments and refunds deny every authenticated persona", async () => {
  for (const persona of ["learner", "otherLearner", "coach", "pendingCoach", "admin"]) {
    await assertPaymentRefundWriteDenied({
      name: `direct mutation ${persona}`,
      client: clients[persona],
    })
  }
  assert.deepEqual(await readBaselineSnapshot(observer), baseline)
})

test("direct mutation matrix: schedule ordinary writes follow owner/admin policy", async () => {
  try {
    for (const persona of ["learner", "otherLearner", "pendingCoach"]) {
      await assertScheduleOrdinaryWriteCell({
        name: `direct mutation ${persona} schedule denied`,
        client: clients[persona],
        allowed: false,
      })
    }
    assert.deepEqual(await readBaselineSnapshot(observer), baseline)
    await assertScheduleOrdinaryWriteCell({
      name: "direct mutation owning coach schedule allowed",
      client: clients.coach,
      allowed: true,
    })
    await restoreDirectWriteBaselines(observer, baseline)
    await assertScheduleOrdinaryWriteCell({
      name: "direct mutation admin schedule allowed",
      client: clients.admin,
      allowed: true,
    })
  } finally {
    await restoreDirectWriteBaselines(observer, baseline)
  }
})

test("direct mutation matrix: owning coach reserved_count denied while admin allowed", async () => {
  try {
    await assertScheduleReservedCountCell({
      name: "direct mutation owning coach reserved_count denied",
      client: clients.coach,
      allowed: false,
    })
    assert.deepEqual(await readBaselineSnapshot(observer), baseline)
    await assertScheduleReservedCountCell({
      name: "direct mutation admin reserved_count allowed",
      client: clients.admin,
      allowed: true,
    })
  } finally {
    await restoreDirectWriteBaselines(observer, baseline)
  }
})

test("authorized cancellation only through RPC: learner cancels own confirmed reservation atomically", async () => {
  try {
    const { data, error } = await clients.learner.rpc("cancel_reservation", {
      checked_reservation_id: fixedIds.cancellableReservation,
      checked_reason: "Todo4 learner RPC cancellation",
    })

    assert.ifError(error)
    assert.equal(data.length, 1)
    assert.equal(data[0].reservation_status, "cancelled_by_user")
    assert.equal(data[0].refund_amount, 7000)
    assert.equal(data[0].refund_status, "requested")

    assert.deepEqual(await readCancellationObserverState(observer), {
      reservation_status: "cancelled_by_user",
      has_cancelled_at: true,
      cancellation_reason: "Todo4 learner RPC cancellation",
      reserved_count: 0,
      cancellation_refunds: 1,
      notifications: 1,
      audit_logs: 1,
    })
  } finally {
    await restoreCancellableBaseline(observer, baseline)
  }
})
