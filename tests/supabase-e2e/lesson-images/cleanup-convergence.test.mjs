import assert from "node:assert/strict"
import test from "node:test"

import { convergeOwnedExpiredIntent } from "./live/cleanup-convergence.mjs"

test("owned cleanup converges when a peer claims and finalizes the intent", async () => {
  let state = { intentStatus: "claimed", objectExists: true }
  let batchCalls = 0
  let waitCalls = 0

  const result = await convergeOwnedExpiredIntent(
    {
      readState: async () => state,
      runBatch: async () => {
        batchCalls += 1
        return { claimed: 0, cleaned: 0, failed: 0 }
      },
    },
    {
      maxChecks: 2,
      wait: async () => {
        waitCalls += 1
        state = { intentStatus: "cleaned", objectExists: false }
      },
    },
  )

  assert.deepEqual(result, { checks: 2, claimed: 0, cleaned: 0, failed: 0 })
  assert.equal(batchCalls, 0)
  assert.equal(waitCalls, 1)
})

test("owned cleanup drives a batch only while the intent remains claimable", async () => {
  let state = { intentStatus: "pending", objectExists: true }

  const result = await convergeOwnedExpiredIntent({
    readState: async () => state,
    runBatch: async () => {
      state = { intentStatus: "cleaned", objectExists: false }
      return { claimed: 1, cleaned: 1, failed: 0 }
    },
  })

  assert.deepEqual(result, { checks: 2, claimed: 1, cleaned: 1, failed: 0 })
})
