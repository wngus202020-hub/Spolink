import assert from "node:assert/strict"
import test from "node:test"

import {
  flushMicrotasks,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS,
  runOpportunisticLessonImageCleanup,
} from "./fixtures.mjs"

test("Given a slow cleanup provider, when N callers exhaust their budgets, then one cleanup remains in flight and a settled cleanup permits the next run", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const unhandled = []
  const listener = (reason) => unhandled.push(reason)
  process.on("unhandledRejection", listener)
  const pending = []
  const reported = []
  let cleanupCalls = 0
  let inFlight = 0
  let maximumInFlight = 0

  try {
    const dependencies = {
      reportOpportunisticCleanupError: (error) => reported.push(error),
      runOpportunisticCleanup: () => {
        cleanupCalls += 1
        inFlight += 1
        maximumInFlight = Math.max(maximumInFlight, inFlight)
        return new Promise((resolve, reject) => {
          pending.push({
            reject: () => {
              inFlight -= 1
              reject(new Error("late cleanup rejection"))
            },
            resolve: () => {
              inFlight -= 1
              resolve()
            },
          })
        })
      },
    }
    const callers = Array.from({ length: 8 }, () =>
      runOpportunisticLessonImageCleanup(dependencies),
    )
    await flushMicrotasks()

    assert.equal(cleanupCalls, 1)
    assert.equal(inFlight, 1)
    assert.equal(maximumInFlight, 1)
    context.mock.timers.tick(LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS)
    await flushMicrotasks()
    await Promise.all(callers)

    assert.equal(cleanupCalls, 1)
    assert.equal(inFlight, 1)
    assert.equal(reported.length, 1)
    const firstCleanup = pending.shift()
    assert.ok(firstCleanup)
    firstCleanup.reject()
    await flushMicrotasks()

    const next = runOpportunisticLessonImageCleanup(dependencies)
    await flushMicrotasks()

    assert.equal(cleanupCalls, 2)
    assert.equal(inFlight, 1)
    const nextCleanup = pending.shift()
    assert.ok(nextCleanup)
    nextCleanup.resolve()
    await next
    context.mock.timers.tick(LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS)
    await flushMicrotasks()

    assert.equal(maximumInFlight, 1)
    assert.equal(reported.length, 1)
    assert.equal(unhandled.length, 0)
  } finally {
    process.off("unhandledRejection", listener)
    context.mock.timers.reset()
  }
})
