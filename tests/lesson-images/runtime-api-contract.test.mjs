import assert from "node:assert/strict"
import test from "node:test"

await import("../profile-api/fixtures.mjs")

const {
  deleteLessonImage,
  issueLessonImageUploadIntent,
  registerLessonImage,
  reorderLessonImages,
} = await import("../../lib/lessons/lesson-image-client.ts")
const {
  LESSON_IMAGE_MAX_BYTES,
  LESSON_IMAGE_MAX_IDS,
  lessonImageOrderRequestSchema,
  lessonImageUploadIntentRequestSchema,
} = await import("../../lib/lessons/lesson-image-contract.ts")

const lessonId = "10000000-0000-4000-8000-000000000001"
const imageIds = Array.from(
  { length: LESSON_IMAGE_MAX_IDS },
  (_, index) => `20000000-0000-4000-8000-00000000000${index + 1}`,
)
const intentId = "30000000-0000-4000-8000-000000000001"
const objectName = `${lessonId}/40000000-0000-4000-8000-000000000001.webp`

test("Given lesson image mutations, when the runtime client sends them, then only the four lesson-scoped API contracts are used", async (context) => {
  // Given
  const requests = []
  context.mock.method(globalThis, "fetch", async (input, init) => {
    requests.push([input, init.method])
    if (String(input).endsWith("/upload-intents")) {
      return jsonResponse(
        {
          data: {
            expiresAt: "2026-08-26T12:00:00.000Z",
            expiresIn: 7200,
            intentId,
            objectName,
            token: "ephemeral",
            uploadUrl: "/signed",
          },
        },
        201,
      )
    }
    return jsonResponse({ data: { images: [] } }, init.method === "POST" ? 201 : 200)
  })

  // When
  await issueLessonImageUploadIntent(lessonId, { mimeType: "image/webp", sizeBytes: 12 })
  await registerLessonImage(lessonId, { intentId, objectName })
  await reorderLessonImages(lessonId, { expectedImageIds: [], orderedImageIds: [] })
  await deleteLessonImage(lessonId, imageIds[0], { expectedImageIds: imageIds })

  // Then
  assert.deepEqual(requests, [
    [`/api/lessons/${lessonId}/images/upload-intents`, "POST"],
    [`/api/lessons/${lessonId}/images`, "POST"],
    [`/api/lessons/${lessonId}/images/order`, "PATCH"],
    [`/api/lessons/${lessonId}/images/${imageIds[0]}`, "DELETE"],
  ])
  assert.equal(
    requests.some(([path]) => String(path).startsWith("/api/storage/")),
    false,
  )
})

test("Given upload and ordering boundaries, when runtime schemas parse them, then MIME, byte, uniqueness, permutation, and five-image limits are enforced", () => {
  // Given
  const sixImageIds = [...imageIds, "20000000-0000-4000-8000-000000000006"]

  // When
  const validUpload = lessonImageUploadIntentRequestSchema.safeParse({
    mimeType: "image/jpeg",
    sizeBytes: LESSON_IMAGE_MAX_BYTES,
  })
  const invalidUploads = [
    { mimeType: "image/gif", sizeBytes: 1 },
    { mimeType: "image/png", sizeBytes: LESSON_IMAGE_MAX_BYTES + 1 },
  ].map((input) => lessonImageUploadIntentRequestSchema.safeParse(input).success)
  const invalidOrders = [
    { expectedImageIds: sixImageIds, orderedImageIds: sixImageIds },
    { expectedImageIds: imageIds, orderedImageIds: imageIds.slice(1) },
    { expectedImageIds: imageIds, orderedImageIds: imageIds.map(() => imageIds[0]) },
  ].map((input) => lessonImageOrderRequestSchema.safeParse(input).success)

  // Then
  assert.equal(LESSON_IMAGE_MAX_BYTES, 5_242_880)
  assert.equal(LESSON_IMAGE_MAX_IDS, 5)
  assert.equal(validUpload.success, true)
  assert.deepEqual(invalidUploads, [false, false])
  assert.deepEqual(invalidOrders, [false, false, false])
})

test("Given lesson image API responses, when ready and deleting state shapes arrive, then only the bounded ready-image contract is accepted", async (context) => {
  // Given
  const readyImages = imageIds.map((id, sortOrder) => ({
    id,
    objectName: `${lessonId}/40000000-0000-4000-8000-00000000000${sortOrder + 1}.jpg`,
    sortOrder,
  }))
  const responses = [
    jsonResponse({ data: { images: readyImages } }, 201),
    jsonResponse(
      {
        data: {
          images: [{ ...readyImages[0], lifecycleState: "deleting" }],
        },
      },
      201,
    ),
    jsonResponse(
      {
        data: {
          images: [
            ...readyImages,
            {
              id: "20000000-0000-4000-8000-000000000006",
              objectName: `${lessonId}/40000000-0000-4000-8000-000000000006.jpg`,
              sortOrder: 5,
            },
          ],
        },
      },
      201,
    ),
  ]
  context.mock.method(globalThis, "fetch", async () => responses.shift())

  // When
  const ready = await registerLessonImage(lessonId, { intentId, objectName })
  const deleting = await registerLessonImage(lessonId, { intentId, objectName })
  const overLimit = await registerLessonImage(lessonId, { intentId, objectName })

  // Then
  assert.equal(ready.status, "success")
  assert.deepEqual(deleting, { code: "UNAVAILABLE", status: "error", statusCode: 503 })
  assert.deepEqual(overLimit, { code: "UNAVAILABLE", status: "error", statusCode: 503 })
})

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
