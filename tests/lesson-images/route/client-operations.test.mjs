import assert from "node:assert/strict"
import test from "node:test"

import {
  imageId,
  intentId,
  jsonResponse,
  lessonId,
  objectName,
  readyImages,
  secondImageId,
} from "./fixtures.mjs"

const {
  deleteLessonImage,
  issueLessonImageUploadIntent,
  registerLessonImage,
  reorderLessonImages,
  uploadLessonImageToSignedUrl,
} = await import("../../../lib/lessons/lesson-image-client.ts")

test("Given browser mutations, when fetch resolves or rejects, then every fixed code stays discriminated without secret persistence", async (context) => {
  const requests = []
  const responses = [
    jsonResponse(
      {
        data: {
          expiresAt: "2026-08-25T12:00:00.000Z",
          expiresIn: 7200,
          intentId,
          objectName,
          token: "once",
          uploadUrl: "/signed",
        },
      },
      201,
    ),
    ...[401, 403, 404, 409, 415, 422, 503].map((statusCode) => {
      const code = {
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        415: "UNSUPPORTED_MEDIA_TYPE",
        422: "VALIDATION_ERROR",
        503: "UNAVAILABLE",
      }[statusCode]
      return jsonResponse({ error: { code, details: [], message: "안전한 오류" } }, statusCode)
    }),
  ]
  context.mock.method(globalThis, "fetch", async (input, init) => {
    requests.push({ input, init })
    return responses.shift()
  })

  const success = await issueLessonImageUploadIntent(lessonId, {
    mimeType: "image/webp",
    sizeBytes: 12,
  })
  const failures = []
  for (let index = 0; index < 7; index += 1) {
    failures.push(await registerLessonImage(lessonId, { intentId, objectName }))
  }

  assert.equal(success.status, "success")
  assert.equal(success.data.token, "once")
  assert.deepEqual(
    failures.map((result) => [result.status, result.code, result.statusCode]),
    [
      ["error", "UNAUTHENTICATED", 401],
      ["error", "FORBIDDEN", 403],
      ["error", "NOT_FOUND", 404],
      ["error", "CONFLICT", 409],
      ["error", "UNSUPPORTED_MEDIA_TYPE", 415],
      ["error", "VALIDATION_ERROR", 422],
      ["error", "UNAVAILABLE", 503],
    ],
  )
  assert.equal(requests[0].input, `/api/lessons/${lessonId}/images/upload-intents`)
  assert.equal(requests[0].init.credentials, "same-origin")
  assert.equal(requests[0].init.headers["Content-Type"], "application/json")
  assert.doesNotMatch(JSON.stringify(requests), /service.role|authorization/iu)
})

test("Given reorder, delete, and signed upload browser operations, when invoked, then methods, paths, JSON, and no-overwrite upload are exact", async (context) => {
  const requests = []
  context.mock.method(globalThis, "fetch", async (input, init) => {
    requests.push({ input, init })
    return input === "/signed"
      ? new Response(null, { status: 200 })
      : jsonResponse({ data: { images: readyImages } }, 200)
  })

  await reorderLessonImages(lessonId, {
    expectedImageIds: [imageId, secondImageId],
    orderedImageIds: [secondImageId, imageId],
  })
  await deleteLessonImage(lessonId, imageId, { expectedImageIds: [imageId, secondImageId] })
  const upload = await uploadLessonImageToSignedUrl("/signed", "once", new Blob(["x"]), {
    upsert: false,
  })

  assert.deepEqual(
    requests.map(({ input, init }) => [input, init.method]),
    [
      [`/api/lessons/${lessonId}/images/order`, "PATCH"],
      [`/api/lessons/${lessonId}/images/${imageId}`, "DELETE"],
      ["/signed", "PUT"],
    ],
  )
  assert.equal(requests[2].init.headers["x-upsert"], "false")
  assert.equal(requests[2].init.headers.Authorization, "Bearer once")
  assert.deepEqual(upload, { status: "success" })
})
