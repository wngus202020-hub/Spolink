import assert from "node:assert/strict"
import test from "node:test"

import {
  hasLessonImageMimeTypeExtension,
  LESSON_IMAGE_ERROR_STATUS_BY_CODE,
  LESSON_IMAGE_EXTENSION_BY_MIME_TYPE,
  LESSON_IMAGE_MAX_BYTES,
  LESSON_IMAGE_MAX_IDS,
  LESSON_IMAGE_SIGNED_UPLOAD_TTL_SECONDS,
  lessonImageDeleteRequestSchema,
  lessonImageErrorResultSchema,
  lessonImageObjectNameSchema,
  lessonImageOrderRequestSchema,
  lessonImageRegistrationRequestSchema,
  lessonImageUploadIntentRequestSchema,
} from "../../lib/lessons/lesson-image-contract.ts"

const lessonId = "00000000-0000-4000-8000-000000000001"
const objectId = "00000000-0000-4000-8000-000000000002"
const intentId = "00000000-0000-4000-8000-000000000003"
const imageIds = [
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
  "00000000-0000-4000-8000-000000000013",
  "00000000-0000-4000-8000-000000000014",
  "00000000-0000-4000-8000-000000000015",
]

test("Given browser upload-intent inputs, when exact MIME types and the 5 MiB boundary arrive, then only valid values parse", () => {
  // Given
  const validInputs = [
    { mimeType: "image/jpeg", sizeBytes: LESSON_IMAGE_MAX_BYTES },
    { mimeType: "image/png", sizeBytes: 1 },
    { mimeType: "image/webp", sizeBytes: LESSON_IMAGE_MAX_BYTES },
  ]

  // When
  const results = validInputs.map((input) => lessonImageUploadIntentRequestSchema.safeParse(input))

  // Then
  assert.equal(LESSON_IMAGE_MAX_BYTES, 5_242_880)
  assert.equal(LESSON_IMAGE_SIGNED_UPLOAD_TTL_SECONDS, 7_200)
  assert.deepEqual(LESSON_IMAGE_EXTENSION_BY_MIME_TYPE, {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  })
  assert.deepEqual(
    results.map((result) => result.success),
    [true, true, true],
  )
})

test("Given a parsed object name and an upload MIME type, when their extension pairing is checked, then only exact pairs match", () => {
  // Given
  const pngObjectName = `${lessonId}/${objectId}.png`

  // When
  const matching = hasLessonImageMimeTypeExtension(pngObjectName, "image/png")
  const mismatched = hasLessonImageMimeTypeExtension(pngObjectName, "image/jpeg")

  // Then
  assert.equal(matching, true)
  assert.equal(mismatched, false)
})

test("Given malformed browser upload-intent inputs, when size, MIME, or caller-owned fields arrive, then parsing rejects them", () => {
  // Given
  const malformedInputs = [
    { mimeType: "image/webp", sizeBytes: 0 },
    { mimeType: "image/webp", sizeBytes: LESSON_IMAGE_MAX_BYTES + 1 },
    { mimeType: "image/gif", sizeBytes: 1 },
    { mimeType: "image/jpeg", sizeBytes: 1, userId: lessonId },
    { mimeType: "image/jpeg", sizeBytes: 1, coachProfileId: lessonId },
    { mimeType: "image/jpeg", sizeBytes: 1, sortOrder: 0 },
    { mimeType: "image/jpeg", sizeBytes: 1, bucket: "lesson-images" },
    { mimeType: "image/jpeg", sizeBytes: 1, status: "ready" },
    { mimeType: "image/jpeg", sizeBytes: 1, serviceKey: "forbidden" },
  ]

  // When
  const results = malformedInputs.map(
    (input) => lessonImageUploadIntentRequestSchema.safeParse(input).success,
  )

  // Then
  assert.deepEqual(results, Array(malformedInputs.length).fill(false))
})

test("Given a server-issued canonical object name, when registration arrives, then only the exact immutable path shape parses", () => {
  // Given
  const objectNames = [
    `${lessonId}/${objectId}.jpg`,
    `${lessonId}/${objectId}.png`,
    `${lessonId}/${objectId}.webp`,
  ]

  // When
  const registrations = objectNames.map(
    (objectName) =>
      lessonImageRegistrationRequestSchema.safeParse({ intentId, objectName }).success,
  )
  const rejectedObjectNames = [
    `${lessonId}/${objectId}.jpeg`,
    `${lessonId}/${objectId}.gif`,
    `${lessonId}/not-a-uuid.png`,
    `other/${lessonId}/${objectId}.png`,
    `https://storage.invalid/${lessonId}/${objectId}.png`,
  ].map((objectName) => lessonImageObjectNameSchema.safeParse(objectName).success)
  const forbiddenRegistration = lessonImageRegistrationRequestSchema.safeParse({
    intentId,
    objectName: `${lessonId}/${objectId}.png`,
    userId: lessonId,
  }).success

  // Then
  assert.deepEqual(registrations, [true, true, true])
  assert.deepEqual(rejectedObjectNames, [false, false, false, false, false])
  assert.equal(forbiddenRegistration, false)
})

test("Given order and delete requests, when IDs are malformed, duplicated, over limit, or mismatched, then strict parsing rejects them", () => {
  // Given
  const orderedImageIds = [...imageIds].reverse()
  const sixImageIds = [...imageIds, "00000000-0000-4000-8000-000000000016"]

  // When
  const validOrder = lessonImageOrderRequestSchema.safeParse({
    expectedImageIds: imageIds,
    orderedImageIds,
  })
  const rejected = [
    lessonImageOrderRequestSchema.safeParse({
      expectedImageIds: imageIds,
      orderedImageIds: [imageIds[0], imageIds[0]],
    }).success,
    lessonImageOrderRequestSchema.safeParse({
      expectedImageIds: imageIds,
      orderedImageIds: ["not-a-uuid"],
    }).success,
    lessonImageOrderRequestSchema.safeParse({
      expectedImageIds: sixImageIds,
      orderedImageIds: sixImageIds,
    }).success,
    lessonImageOrderRequestSchema.safeParse({
      expectedImageIds: imageIds,
      orderedImageIds: imageIds.slice(0, 4),
    }).success,
    lessonImageDeleteRequestSchema.safeParse({ expectedImageIds: sixImageIds }).success,
    lessonImageDeleteRequestSchema.safeParse({ expectedImageIds: [imageIds[0], imageIds[0]] })
      .success,
    lessonImageDeleteRequestSchema.safeParse({ expectedImageIds: imageIds, status: "ready" })
      .success,
  ]

  // Then
  assert.equal(LESSON_IMAGE_MAX_IDS, 5)
  assert.equal(validOrder.success, true)
  assert.deepEqual(rejected, Array(rejected.length).fill(false))
})

test("Given browser-safe lesson-image errors, when typed codes are mapped to HTTP results, then all fixed statuses parse", () => {
  // Given
  const expectedStatuses = [401, 403, 404, 409, 415, 422, 503]

  // When
  const results = Object.entries(LESSON_IMAGE_ERROR_STATUS_BY_CODE).map(([code, statusCode]) =>
    lessonImageErrorResultSchema.safeParse({ code, status: "error", statusCode }),
  )

  // Then
  assert.deepEqual(Object.values(LESSON_IMAGE_ERROR_STATUS_BY_CODE), expectedStatuses)
  assert.deepEqual(
    results.map((result) => result.success),
    Array(expectedStatuses.length).fill(true),
  )
})
