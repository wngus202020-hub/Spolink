import assert from "node:assert/strict"
import test from "node:test"

import {
  assertLessonImageError,
  cleanupExpiredLessonImageUploads,
  intent,
  lessonId,
  objectId,
} from "./fixtures.mjs"

test("Given multiple expired claims and one Storage failure, when cleanup runs, then every claim finalizes independently", async () => {
  const calls = []
  const claims = [
    intent({ claimToken: "50000000-0000-4000-8000-000000000001" }),
    intent({
      claimToken: "50000000-0000-4000-8000-000000000002",
      id: "20000000-0000-4000-8000-000000000002",
      objectName: `${lessonId}/${objectId}.png`,
    }),
    intent({
      claimToken: "50000000-0000-4000-8000-000000000003",
      id: "20000000-0000-4000-8000-000000000003",
      objectName: `${lessonId}/${objectId}.jpg`,
    }),
  ]

  const result = await cleanupExpiredLessonImageUploads(3, {
    claimExpiredUploadIntents: async (limit) => {
      assert.equal(limit, 3)
      return claims
    },
    finalizeCleanup: async (id, token, cleaned) => calls.push({ cleaned, id, token }),
    removeObject: async (_bucket, name) => {
      if (name.endsWith(".png")) throw new Error("storage unavailable")
      return name.endsWith(".jpg") ? "not_found" : "removed"
    },
  })

  assert.deepEqual(result, { claimed: 3, cleaned: 2, failed: 1 })
  assert.deepEqual(
    calls.map(({ cleaned }) => cleaned),
    [true, false, true],
  )
})

test("Given an idempotently finalized cleanup claim, when cleanup repeats, then counts remain accurate", async () => {
  let pass = 0

  const first = await cleanupExpiredLessonImageUploads(1, {
    claimExpiredUploadIntents: async () =>
      pass++ === 0 ? [intent({ claimToken: "50000000-0000-4000-8000-000000000001" })] : [],
    finalizeCleanup: async () => {},
    removeObject: async () => "not_found",
  })
  const second = await cleanupExpiredLessonImageUploads(1, {
    claimExpiredUploadIntents: async () => [],
    finalizeCleanup: async () => {},
    removeObject: async () => "not_found",
  })

  assert.deepEqual(first, { claimed: 1, cleaned: 1, failed: 0 })
  assert.deepEqual(second, { claimed: 0, cleaned: 0, failed: 0 })
})

test("Given a malformed cleanup limit, when cleanup starts, then no claim is made", async () => {
  let claimed = false

  const action = cleanupExpiredLessonImageUploads(0, {
    claimExpiredUploadIntents: async () => {
      claimed = true
      return []
    },
    finalizeCleanup: async () => {},
    removeObject: async () => "removed",
  })

  await assertLessonImageError(action, "invalid_input")
  assert.equal(claimed, false)
})
