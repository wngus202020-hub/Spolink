import assert from "node:assert/strict"
import test from "node:test"

import {
  cleanup,
  deleteLessonImage,
  imageId,
  intentId,
  lessonId,
  objectName,
  registerLessonImage,
  registrationDependencies,
} from "./fixtures.mjs"

test("duplicate registration returned by the database preserves the canonical object", async () => {
  let removalCalls = 0
  const registered = { id: imageId, lesson_id: lessonId }
  const dependencies = registrationDependencies(registered, () => {
    removalCalls += 1
  })
  dependencies.finalizeUploadIntent = async () =>
    assert.fail("successful retry must not cancel its intent")

  const first = await registerLessonImage({ intentId, objectName }, dependencies)
  const second = await registerLessonImage({ intentId, objectName }, dependencies)

  assert.equal(first, registered)
  assert.equal(second, registered)
  assert.equal(removalCalls, 0)
})

test("proven duplicate deletion treats Storage 404 as success and finalizes the current list", async () => {
  const ready = [{ id: "30000000-0000-4000-8000-000000000002", sortOrder: 0 }]
  let finalizeCalls = 0

  const result = await deleteLessonImage(
    { expectedImageIds: [], imageId, lessonId },
    {
      ...cleanup,
      beginDelete: async () => ({ filePath: objectName, kind: "deleting" }),
      finalizeDelete: async () => {
        finalizeCalls += 1
        return ready
      },
      removeObject: async () => "not_found",
    },
  )

  assert.equal(result, ready)
  assert.equal(finalizeCalls, 1)
})

test("registration linkage and deletion receipt behavior remain durable across retries", async () => {
  let removalCalls = 0
  let finalizeCalls = 0
  const registered = { id: imageId, lesson_id: lessonId }
  const first = await registerLessonImage(
    { intentId, objectName },
    registrationDependencies(registered, () => {
      removalCalls += 1
    }),
  )
  const ready = await deleteLessonImage(
    { expectedImageIds: [imageId], imageId, lessonId },
    {
      ...cleanup,
      beginDelete: async () => ({ filePath: objectName, kind: "deleting" }),
      finalizeDelete: async () => {
        finalizeCalls += 1
        return []
      },
      removeObject: async () => "not_found",
    },
  )

  assert.equal(first.id, imageId)
  assert.equal(first.lesson_id, lessonId)
  assert.equal(removalCalls, 0)
  assert.deepEqual([ready, finalizeCalls], [[], 1])
})
