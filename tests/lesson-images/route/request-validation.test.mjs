import assert from "node:assert/strict"
import test from "node:test"

import {
  createDeleteLessonImageRouteHandler,
  createIssueLessonImageUploadIntentRouteHandler,
  createRegisterLessonImageRouteHandler,
  imageContext,
  imageId,
  intentId,
  jsonRequest,
  lessonContext,
  lessonId,
  objectName,
  routeDependencies,
  workflowDependencies,
} from "./fixtures.mjs"

const { mapLessonImageRpcError } = await import(
  "../../../lib/lessons/lesson-image-repository-errors.ts"
)

test("Given hostile or malformed requests, when parsed, then same-origin, media type, JSON, shape, ids, config, and auth run in order", async () => {
  let dependencyCalls = 0
  const dependencies = routeDependencies(
    {},
    {
      createWorkflowDependencies: async () => {
        dependencyCalls += 1
        return workflowDependencies({ actor: "unauthenticated" })
      },
    },
  )
  const handler = createIssueLessonImageUploadIntentRouteHandler(dependencies)
  const scenarios = [
    [jsonRequest("upload-intents", {}, "POST", { origin: "http://evil.invalid" }), 403],
    [jsonRequest("upload-intents", {}, "POST", { contentType: "text/plain" }), 415],
    [jsonRequest("upload-intents", "{", "POST"), 422],
    [jsonRequest("upload-intents", { mimeType: "image/gif", sizeBytes: 1 }), 422],
    [jsonRequest("upload-intents", { mimeType: "image/png", sizeBytes: 1 }), 401],
  ]

  for (const [request, status] of scenarios) {
    const response = await handler(request, lessonContext())
    assert.equal(response.status, status)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
  }
  assert.equal(dependencyCalls, 1)

  const unconfigured = createIssueLessonImageUploadIntentRouteHandler(
    routeDependencies({}, { isSupabaseConfigured: () => false }),
  )
  assert.equal(
    (
      await unconfigured(
        jsonRequest("upload-intents", { mimeType: "image/png", sizeBytes: 1 }),
        lessonContext(),
      )
    ).status,
    503,
  )
  assert.equal(
    (
      await handler(jsonRequest("upload-intents", { mimeType: "image/png", sizeBytes: 1 }), {
        params: Promise.resolve({ lessonId: "bad" }),
      })
    ).status,
    422,
  )
})

for (const fixture of [
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["CONFLICT", 409],
  ["VALIDATION_ERROR", 422],
  ["UNAVAILABLE", 503],
]) {
  test(`Given a ${fixture[0]} domain failure, when the handler maps it, then ${fixture[1]} has a stable safe envelope`, async () => {
    const handler = createRegisterLessonImageRouteHandler(
      routeDependencies({
        registerImage: async () => ({ code: fixture[0], status: "error", statusCode: fixture[1] }),
      }),
    )
    const response = await handler(jsonRequest("images", { intentId, objectName }), lessonContext())
    const body = await response.json()

    assert.equal(response.status, fixture[1])
    assert.deepEqual(Object.keys(body.error).sort(), ["code", "details", "message"])
    assert.equal(body.error.code, fixture[0])
    assert.equal(body.error.details.length, 0)
    assert.doesNotMatch(
      JSON.stringify(body),
      /service.role|secret|token|lesson-images\/|provider-body/iu,
    )
  })
}

test("Given an invalid image id and a stale delete, when deletion is requested, then validation precedes workflow and conflict remains typed", async () => {
  let deleteCalls = 0
  const dependencies = routeDependencies({
    deleteImage: async () => {
      deleteCalls += 1
      return { code: "CONFLICT", status: "error", statusCode: 409 }
    },
  })
  const handler = createDeleteLessonImageRouteHandler(dependencies)

  assert.equal(
    (
      await handler(jsonRequest("images/bad", { expectedImageIds: [] }, "DELETE"), {
        params: Promise.resolve({ imageId: "bad", lessonId }),
      })
    ).status,
    422,
  )
  assert.equal(
    (
      await handler(
        jsonRequest(`images/${imageId}`, { expectedImageIds: [imageId] }, "DELETE"),
        imageContext(),
      )
    ).status,
    409,
  )
  assert.equal(deleteCalls, 1)
})

test("Given authoritative RPC failures, when repository errors are normalized, then eligibility, ownership, state, stale, limit, missing, validation, and provider cases stay exact", () => {
  const fixtures = [
    ["COACH_NOT_APPROVED", "FORBIDDEN"],
    ["LESSON_NOT_FOUND", "FORBIDDEN"],
    ["LESSON_STATE_CONFLICT", "FORBIDDEN"],
    ["IMAGE_INTENT_NOT_FOUND", "NOT_FOUND"],
    ["IMAGE_OBJECT_NOT_FOUND", "NOT_FOUND"],
    ["LESSON_IMAGE_NOT_FOUND", "NOT_FOUND"],
    ["STALE_LESSON_IMAGES", "CONFLICT"],
    ["LESSON_IMAGE_LIMIT", "CONFLICT"],
    ["IMAGE_OPERATION_PENDING", "CONFLICT"],
    ["IMAGE_OBJECT_INVALID", "VALIDATION_ERROR"],
  ]

  assert.deepEqual(
    fixtures.map(([message]) => mapLessonImageRpcError({ code: "P0001", message })),
    fixtures.map(([, expected]) => expected),
  )
  assert.equal(
    mapLessonImageRpcError({ code: "PGRST000", message: "provider-body-secret" }),
    "UNAVAILABLE",
  )
  assert.equal(
    mapLessonImageRpcError({ code: "P0001", message: "unknown/path/secret" }),
    "UNAVAILABLE",
  )
})

test("Given an authentication provider outage, when workflow authentication runs, then the route returns safe 503 instead of 401", async () => {
  const handler = createIssueLessonImageUploadIntentRouteHandler(
    routeDependencies(
      {},
      {
        createWorkflowDependencies: async () => workflowDependencies({ actor: "unavailable" }),
      },
    ),
  )
  const response = await handler(
    jsonRequest("upload-intents", { mimeType: "image/png", sizeBytes: 1 }),
    lessonContext(),
  )
  assert.equal(response.status, 503)
  assert.doesNotMatch(JSON.stringify(await response.json()), /provider|secret|path/iu)
})
