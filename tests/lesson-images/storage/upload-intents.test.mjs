import assert from "node:assert/strict"
import test from "node:test"

import {
  assertLessonImageError,
  expiresAt,
  intent,
  intentId,
  issueLessonImageUploadIntent,
  LESSON_IMAGE_BUCKET,
  lessonId,
  objectName,
  webpBytes,
} from "./fixtures.mjs"

test("Given valid input, when upload is signed, then intent exists before immutable signing", async () => {
  const calls = []

  const result = await issueLessonImageUploadIntent(
    { lessonId, mimeType: "image/webp", sizeBytes: webpBytes.length },
    {
      cancelUploadIntent: async () => assert.fail("successful signing must not cancel"),
      createSignedUploadUrl: async (bucket, name, options) => {
        calls.push({ bucket, name, options, step: "sign" })
        return { signedUrl: "/signed-upload", token: "public-upload-token" }
      },
      createUploadIntent: async () => {
        calls.push({ step: "intent" })
        return intent()
      },
    },
  )

  assert.deepEqual(calls, [
    { step: "intent" },
    { bucket: LESSON_IMAGE_BUCKET, name: objectName, options: { upsert: false }, step: "sign" },
  ])
  assert.deepEqual(result, {
    expiresAt,
    expiresIn: 7200,
    intentId,
    objectName,
    token: "public-upload-token",
    uploadUrl: "/signed-upload",
  })
})

test("Given a Postgres offset timestamp, when upload intent creation crosses the storage boundary, then signing preserves it", async () => {
  const offsetExpiresAt = "2026-08-25T12:00:00+00:00"

  const result = await issueLessonImageUploadIntent(
    { lessonId, mimeType: "image/webp", sizeBytes: 12 },
    {
      cancelUploadIntent: async () => {},
      createSignedUploadUrl: async () => ({ signedUrl: "/signed", token: "upload-token" }),
      createUploadIntent: async () => intent({ expiresAt: offsetExpiresAt }),
      reportOpportunisticCleanupError: () => {},
      runOpportunisticCleanup: async () => {},
    },
  )

  assert.equal(result.expiresAt, offsetExpiresAt)
})

test("Given caller path fields, when upload intent input is parsed, then no intent is created", async () => {
  let created = false

  const action = issueLessonImageUploadIntent(
    { lessonId, mimeType: "image/webp", objectName: "caller/path.webp", sizeBytes: 12 },
    {
      cancelUploadIntent: async () => {},
      createSignedUploadUrl: async () => ({ signedUrl: "", token: "" }),
      createUploadIntent: async () => {
        created = true
        return intent()
      },
    },
  )

  await assertLessonImageError(action, "invalid_input")
  assert.equal(created, false)
})

test("Given signing failure, when intent was persisted, then it is cancelled and error is redacted", async () => {
  const cancelled = []

  const action = issueLessonImageUploadIntent(
    { lessonId, mimeType: "image/webp", sizeBytes: 12 },
    {
      cancelUploadIntent: async (id) => cancelled.push(id),
      createSignedUploadUrl: async () => {
        throw new Error("service_role=do-not-leak")
      },
      createUploadIntent: async () => intent(),
    },
  )

  const error = await assertLessonImageError(action, "signing_failed")
  assert.deepEqual(cancelled, [intentId])
  assert.doesNotMatch(JSON.stringify(error), /service_role|do-not-leak/u)
})
