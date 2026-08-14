import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import test from "node:test"

import { ensureAuthGatewayReady, provisionWithAuthReadiness } from "./auth-rls/runtime.mjs"
import {
  actorFullRefundCases,
  deniedCases,
  learnerRefundCases,
  pendingPaymentCases,
  slotSuffixes,
} from "./cancellation-policy-cases.mjs"
import { createPolicyObserver, slotByReservationSuffix } from "./cancellation-policy-helper.mjs"
import { createPolicyRuntime } from "./cancellation-policy-runtime.mjs"
import { acquireLiveQaLock } from "./live-qa-lock.mjs"
import {
  assertNextTypeStability,
  assertNoRootEnvFiles,
  capturePort3002,
  startNextServer,
} from "./next-server.mjs"
import { assertSupabaseSsrContracts } from "./ssr-cookie-jar.mjs"

const slots = Object.fromEntries(
  Object.entries(slotSuffixes).map(([key, suffix]) => [key, slotByReservationSuffix(suffix)]),
)
const state = {
  observations: [],
  observer: null,
  provision: null,
  server: null,
}
const runtime = createPolicyRuntime(state)
let before3002
let releaseLiveQaLock
let typeHashBefore

test.before(async () => {
  releaseLiveQaLock = await acquireLiveQaLock("cancellation-policy")
  await assertNoRootEnvFiles()
  typeHashBefore = await assertNextTypeStability()
  await assertSupabaseSsrContracts()
  before3002 = await capturePort3002()
  await ensureAuthGatewayReady()
  state.provision = await provisionWithAuthReadiness()
  state.observer = createPolicyObserver(state.provision.status)
  state.server = await startNextServer({ mode: "configured", status: state.provision.status })
})

test.after(async () => {
  try {
    if (process.env.SPOLINK_E2E_OBSERVER_ARTIFACT) {
      await writeObserverArtifact(process.env.SPOLINK_E2E_OBSERVER_ARTIFACT)
    }
    if (state.server) await state.server.stop()
    if (state.observer) await state.observer.end({ timeout: 1 })
    if (state.provision) await state.provision.cleanup()
  } finally {
    if (releaseLiveQaLock) await releaseLiveQaLock()
  }
})

test("baseline characterization: live learner cancellation produces observer shape on policy slot 410", async () =>
  runtime.runSuccess({
    actor: "learner",
    name: "baseline learner 70",
    reason: "Todo6 baseline",
    refund: 7000,
    slot: slots.learner70,
    status: "cancelled_by_user",
  }))

for (const policyCase of learnerRefundCases) {
  test(policyCase.name, async () =>
    runtime.runSuccess({
      actor: "learner",
      name: policyCase.name,
      reason: `Todo6 ${slots[policyCase.slotKey].reservation}`,
      refund: policyCase.refund,
      slot: slots[policyCase.slotKey],
      status: "cancelled_by_user",
    }),
  )
}

for (const policyCase of actorFullRefundCases) {
  test(`slot 313 ${policyCase.actor} cancellation restores between actors and returns full refund`, async () =>
    runtime.runSuccess({
      actor: policyCase.actor,
      name: `slot 313 ${policyCase.actor}`,
      reason: `Todo6 ${policyCase.actor} full`,
      recipients: policyCase.recipients,
      refund: 10001,
      slot: slots.actorFull,
      status: policyCase.status,
    }))
}

for (const policyCase of pendingPaymentCases) {
  test(`slot 314 pending payment ${policyCase.actor} cancellation cancels payment without refund`, async () =>
    runtime.runSuccess({
      actor: policyCase.actor,
      before: ["pending_payment", "ready"],
      name: `slot 314 ${policyCase.actor}`,
      reason: `Todo6 pending ${policyCase.actor}`,
      recipients: policyCase.recipients,
      refund: null,
      slot: slots.pending,
      status: policyCase.status,
    }))
}

for (const policyCase of deniedCases) {
  test(policyCase.testName, async () =>
    runtime.runDenied({
      actor: policyCase.actor,
      code: policyCase.code,
      name: policyCase.name,
      options: policyCase.options ?? {},
      slot: slots[policyCase.slotKey],
      status: policyCase.status,
    }),
  )
}

test("slot 315 exact repeat is idempotent and conflicting repeat adds no side effects", async () =>
  runtime.runIdempotentRepeat(slots.idempotent))

test("server ownership preserves next type state and port 3002", async () => {
  assert.notEqual(state.server.port, 3002)
  assert.equal(await assertNextTypeStability(), typeHashBefore)
  assert.equal(await capturePort3002(), before3002)
})

async function writeObserverArtifact(outputPath) {
  await writeFile(
    outputPath,
    JSON.stringify({
      after3002: await capturePort3002(),
      before3002,
      observations: state.observations,
      selectedPort: state.server?.port ?? null,
      typeHashAfter: await assertNextTypeStability(),
      typeHashBefore,
    }),
    { mode: 0o600 },
  )
}
