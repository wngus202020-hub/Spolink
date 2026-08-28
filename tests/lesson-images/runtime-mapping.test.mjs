import assert from "node:assert/strict"
import test from "node:test"

await import("../profile-api/fixtures.mjs")

const { issueLessonImageUploadIntent } = await import("../../lib/lessons/lesson-image-client.ts")
const { createLessonAuthoringDependencies } = await import(
  "../../lib/lessons/authoring-repository.ts"
)
const { createTransitionLessonRouteHandler } = await import(
  "../../lib/lessons/authoring-route-handlers.ts"
)

const origin = "http://127.0.0.1:3214"
const lessonId = "10000000-0000-4000-8000-000000000001"
const intentId = "20000000-0000-4000-8000-000000000001"
const objectName = `${lessonId}/30000000-0000-4000-8000-000000000001.webp`

test("Given server upload-intent timestamps, when the browser parses the response, then only strict timezone-bearing ISO datetimes are accepted", async () => {
  const originalFetch = globalThis.fetch

  try {
    for (const expiresAt of [
      "2026-08-25T12:00:00.000Z",
      "2026-08-25T12:00:00+00:00",
      "2026-08-25T21:00:00+09:00",
    ]) {
      globalThis.fetch = async () => uploadIntentResponse(expiresAt)

      const result = await issueLessonImageUploadIntent(lessonId, {
        mimeType: "image/webp",
        sizeBytes: 12,
      })

      assert.equal(result.status, "success", expiresAt)
      assert.equal(result.data.expiresAt, expiresAt)
      assert.equal(result.data.expiresIn, 7200)
    }

    for (const expiresAt of [
      "2026-08-25T12:00:00",
      "2026-02-30T12:00:00+00:00",
      "2026-08-25T25:00:00+00:00",
      "not-a-date",
    ]) {
      globalThis.fetch = async () => uploadIntentResponse(expiresAt)

      const result = await issueLessonImageUploadIntent(lessonId, {
        mimeType: "image/webp",
        sizeBytes: 12,
      })

      assert.deepEqual(result, { code: "UNAVAILABLE", status: "error", statusCode: 503 })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Given submit races with intent, register, or delete, when transition_lesson returns the exact pending token, then every route response is the same safe 409", async () => {
  for (const race of ["intent", "register", "delete"]) {
    const response = await transitionResponse({ code: "P0001", message: "IMAGE_OPERATION_PENDING" })
    const body = await response.json()

    assert.equal(response.status, 409, race)
    assert.equal(body.error.code, "IMAGE_OPERATION_PENDING", race)
    assert.equal(JSON.stringify(body).includes("P0001"), false, race)
  }
})

test("Given similar text or generic permission errors, when transition_lesson fails, then they retain internal-error behavior", async () => {
  for (const error of [
    { code: "P0001", message: "IMAGE_OPERATION_PENDING detail" },
    { code: "42501", message: "IMAGE_OPERATION_PENDING" },
    { code: "42501", message: "permission denied" },
  ]) {
    const response = await transitionResponse(error)
    const body = await response.json()

    assert.equal(response.status, 500, `${error.code}:${error.message}`)
    assert.equal(body.error.code, "INTERNAL_ERROR")
    assert.equal(JSON.stringify(body).includes(error.message), false)
  }
})

function uploadIntentResponse(expiresAt) {
  return new Response(
    JSON.stringify({
      data: {
        expiresAt,
        expiresIn: 7200,
        intentId,
        objectName,
        token: "ephemeral-upload-token",
        uploadUrl: "/storage/v1/object/upload/sign/lesson-images/path",
      },
    }),
    { headers: { "Content-Type": "application/json" }, status: 201 },
  )
}

async function transitionResponse(error) {
  const repository = createLessonAuthoringDependencies({
    rpc: async () => ({ data: null, error }),
  })
  const handler = createTransitionLessonRouteHandler({
    createWorkflowDependencies: async () => ({
      ...repository,
      getActorAccess: async () => ({ coachProfileId: "coach-id", kind: "approved_coach" }),
    }),
    isSupabaseConfigured: () => true,
  })

  return handler(
    new Request(`${origin}/api/lessons/${lessonId}/status`, {
      body: JSON.stringify({
        action: "submit",
        expectedUpdatedAt: "2026-08-25T12:00:00.000Z",
      }),
      headers: { "Content-Type": "application/json", Origin: origin },
      method: "POST",
    }),
    { params: Promise.resolve({ lessonId }) },
  )
}
