import assert from "node:assert/strict"
import test from "node:test"

import {
  assertLessonImageError,
  deleteLessonImage,
  imageId,
  lessonId,
  objectName,
} from "./fixtures.mjs"

test("Given deleting metadata, when Storage says 404, then finalize compacts and succeeds", async () => {
  const ready = [{ id: "remaining" }]
  let finalized = false

  const result = await deleteLessonImage(
    { expectedImageIds: [imageId], imageId, lessonId },
    {
      beginDelete: async () => ({ filePath: objectName, kind: "deleting" }),
      finalizeDelete: async () => {
        finalized = true
        return ready
      },
      removeObject: async () => "not_found",
    },
  )

  assert.equal(finalized, true)
  assert.equal(result, ready)
})

test("Given Storage 500, when deletion runs, then metadata stays deleting and error is retryable", async () => {
  let finalized = false

  const action = deleteLessonImage(
    { expectedImageIds: [imageId], imageId, lessonId },
    {
      beginDelete: async () => ({ filePath: objectName, kind: "deleting" }),
      finalizeDelete: async () => {
        finalized = true
        return []
      },
      removeObject: async () => {
        throw new Error("500 provider-body-secret")
      },
    },
  )

  const error = await assertLessonImageError(action, "delete_retryable")
  assert.equal(error.retryable, true)
  assert.equal(finalized, false)
  assert.doesNotMatch(JSON.stringify(error), /provider-body-secret/u)
})

test("Given interrupted DB finalization, when delete retries, then missing object finalizes", async () => {
  let attempts = 0
  const dependencies = {
    beginDelete: async () => ({ filePath: objectName, kind: "deleting" }),
    finalizeDelete: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("temporary database failure")
      return [{ id: "remaining" }]
    },
    removeObject: async () => (attempts === 0 ? "removed" : "not_found"),
  }

  await assertLessonImageError(
    deleteLessonImage({ expectedImageIds: [imageId], imageId, lessonId }, dependencies),
    "delete_finalize_retryable",
  )
  const result = await deleteLessonImage(
    { expectedImageIds: [imageId], imageId, lessonId },
    dependencies,
  )

  assert.deepEqual(result, [{ id: "remaining" }])
})

test("Given an already finalized duplicate delete, when retried, then it succeeds without Storage", async () => {
  let removed = false
  const ready = [{ id: "remaining" }]

  const result = await deleteLessonImage(
    { expectedImageIds: [], imageId, lessonId },
    {
      beginDelete: async () => ({ images: ready, kind: "already_deleted" }),
      finalizeDelete: async () => assert.fail("duplicate must not finalize"),
      removeObject: async () => {
        removed = true
        return "removed"
      },
    },
  )

  assert.equal(removed, false)
  assert.equal(result, ready)
})
