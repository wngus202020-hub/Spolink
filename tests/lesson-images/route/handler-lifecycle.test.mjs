import assert from "node:assert/strict"
import test from "node:test"

import {
  createDeleteLessonImageRouteHandler,
  createIssueLessonImageUploadIntentRouteHandler,
  createRegisterLessonImageRouteHandler,
  createReorderLessonImagesRouteHandler,
  imageContext,
  imageId,
  intentId,
  jsonRequest,
  lessonContext,
  lessonId,
  objectName,
  readyImages,
  routeDependencies,
  secondImageId,
} from "./fixtures.mjs"

test("Given valid owner requests, when the full handler lifecycle runs, then exact statuses, envelopes, headers, and inputs are preserved", async () => {
  const calls = []
  const dependencies = routeDependencies({
    runCleanup: async () => calls.push(["cleanup"]),
    deleteImage: async (input) => {
      calls.push(["delete", input])
      return readyImages.slice(1)
    },
    issueUploadIntent: async (input) => {
      calls.push(["issue", input])
      return {
        expiresAt: "2026-08-25T12:00:00.000Z",
        expiresIn: 7200,
        intentId,
        objectName,
        token: "ephemeral-upload-token",
        uploadUrl: "/storage/v1/object/upload/sign/lesson-images/path",
      }
    },
    registerImage: async (input) => {
      calls.push(["register", input])
      return readyImages
    },
    reorderImages: async (input) => {
      calls.push(["reorder", input])
      return [...readyImages].reverse().map((image, sortOrder) => ({ ...image, sortOrder }))
    },
  })
  const context = lessonContext()

  const intentResponse = await createIssueLessonImageUploadIntentRouteHandler(dependencies)(
    jsonRequest("upload-intents", { mimeType: "image/webp", sizeBytes: 12 }),
    context,
  )
  const registerResponse = await createRegisterLessonImageRouteHandler(dependencies)(
    jsonRequest("images", { intentId, objectName }),
    context,
  )
  const reorderResponse = await createReorderLessonImagesRouteHandler(dependencies)(
    jsonRequest(
      "images/order",
      {
        expectedImageIds: [imageId, secondImageId],
        orderedImageIds: [secondImageId, imageId],
      },
      "PATCH",
    ),
    context,
  )
  const deleteResponse = await createDeleteLessonImageRouteHandler(dependencies)(
    jsonRequest(`images/${imageId}`, { expectedImageIds: [imageId, secondImageId] }, "DELETE"),
    imageContext(),
  )

  assert.deepEqual(
    [intentResponse.status, registerResponse.status, reorderResponse.status, deleteResponse.status],
    [201, 201, 200, 200],
  )
  for (const response of [intentResponse, registerResponse, reorderResponse, deleteResponse]) {
    assert.equal(response.headers.get("cache-control"), "private, no-store")
  }
  assert.deepEqual(await intentResponse.json(), {
    data: {
      expiresAt: "2026-08-25T12:00:00.000Z",
      expiresIn: 7200,
      intentId,
      objectName,
      token: "ephemeral-upload-token",
      uploadUrl: "/storage/v1/object/upload/sign/lesson-images/path",
    },
  })
  assert.deepEqual(await registerResponse.json(), { data: { images: readyImages } })
  assert.deepEqual(await reorderResponse.json(), {
    data: {
      images: [...readyImages].reverse().map((image, sortOrder) => ({ ...image, sortOrder })),
    },
  })
  assert.deepEqual(await deleteResponse.json(), { data: { images: readyImages.slice(1) } })
  assert.deepEqual(calls, [
    ["cleanup"],
    ["issue", { lessonId, mimeType: "image/webp", sizeBytes: 12 }],
    ["cleanup"],
    ["register", { intentId, lessonId, objectName }],
    ["cleanup"],
    [
      "reorder",
      {
        expectedImageIds: [imageId, secondImageId],
        lessonId,
        orderedImageIds: [secondImageId, imageId],
      },
    ],
    ["cleanup"],
    ["delete", { expectedImageIds: [imageId, secondImageId], imageId, lessonId }],
  ])
})
