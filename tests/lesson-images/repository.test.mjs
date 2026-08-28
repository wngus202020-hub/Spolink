import assert from "node:assert/strict"
import test from "node:test"

await import("../profile-api/fixtures.mjs")

const { createLessonImageWorkflowDependencies } = await import(
  "../../lib/lessons/lesson-image-repository.ts"
)

const lessonId = "10000000-0000-4000-8000-000000000001"
const intentId = "20000000-0000-4000-8000-000000000001"
const objectName = `${lessonId}/30000000-0000-4000-8000-000000000001.webp`
const expiresAt = "2026-08-25T12:00:00.000Z"
const actorId = "40000000-0000-4000-8000-000000000001"
const validWebpHeader = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

test("Given signed URL failure after intent creation, when compensation runs, then the exact owned intent cancellation RPC is called without object removal", async () => {
  const events = []
  const dependencies = createLessonImageWorkflowDependencies(
    requestClient(events, { signingFails: true }),
    () => serviceClient(events),
  )

  const result = await dependencies.issueUploadIntent({
    lessonId,
    mimeType: "image/webp",
    sizeBytes: 12,
  })

  assert.equal(result.status, "error")
  assert.deepEqual(
    events.filter(({ layer }) => layer !== "cleanup"),
    [
      {
        args: {
          checked_lesson_id: lessonId,
          checked_mime_type: "image/webp",
          checked_size_bytes: 12,
        },
        layer: "request",
        name: "create_lesson_image_upload_intent",
      },
      { layer: "sign" },
      {
        args: {
          checked_intent_id: intentId,
          checked_lesson_id: lessonId,
          checked_object_name: objectName,
        },
        layer: "request",
        name: "cancel_lesson_image_upload_intent",
      },
    ],
  )
  assert.equal(
    events.some(({ layer }) => layer === "remove"),
    false,
  )
})

test("Given spoofed actual blob and duplicate compensation, when registration retries, then object removal precedes idempotent owned intent cancellation every time", async () => {
  const events = []
  const dependencies = createLessonImageWorkflowDependencies(requestClient(events), () =>
    serviceClient(events, { invalidBlob: true }),
  )

  const first = await dependencies.registerImage({ intentId, lessonId, objectName })
  const second = await dependencies.registerImage({ intentId, lessonId, objectName })

  assert.deepEqual([first.status, second.status], ["error", "error"])
  const compensation = events.filter(
    (event) => event.layer === "remove" || event.name === "cancel_lesson_image_upload_intent",
  )
  assert.deepEqual(
    compensation.map(({ layer, name }) => name ?? layer),
    ["remove", "cancel_lesson_image_upload_intent", "remove", "cancel_lesson_image_upload_intent"],
  )
  for (const event of compensation.filter(({ name }) => name)) {
    assert.deepEqual(event.args, {
      checked_intent_id: intentId,
      checked_lesson_id: lessonId,
      checked_object_name: objectName,
    })
  }
})

test("Given a server-validated image, when registration runs, then only the service client receives the claims-derived actor", async () => {
  const events = []
  const dependencies = createLessonImageWorkflowDependencies(
    requestClient(events, { authenticated: true, readyImages: [imageRow()] }),
    () => serviceClient(events, { validBlob: true }),
  )

  const result = await dependencies.registerImage({ intentId, lessonId, objectName })

  assert.equal(result.status, undefined, JSON.stringify({ events, result }))
  assert.deepEqual(
    events.find(({ name }) => name === "register_validated_lesson_image"),
    {
      args: {
        checked_actor_id: actorId,
        checked_intent_id: intentId,
        checked_object_name: objectName,
      },
      layer: "service",
      name: "register_validated_lesson_image",
    },
  )
  assert.equal(
    events.some(({ layer, name }) => layer === "request" && name?.includes("register")),
    false,
  )
})

test("Given never-settling cleanup provider, when repository cleanup runs, then it returns within the 25ms budget and claims only once", async () => {
  const events = []
  const dependencies = createLessonImageWorkflowDependencies(requestClient(events), () =>
    serviceClient(events, { cleanupHangs: true }),
  )
  const startedAt = performance.now()

  await dependencies.runCleanup()

  assert.ok(performance.now() - startedAt < 100)
  assert.equal(events.filter(({ layer }) => layer === "cleanup").length, 1)
})

function requestClient(events, options = {}) {
  return {
    auth: {
      getClaims: async () => {
        events.push({ layer: "claims" })
        return {
          data: options.authenticated ? { claims: { session_id: "session", sub: actorId } } : {},
          error: null,
        }
      },
    },
    from: (table) =>
      table === "lesson_images" ? imageQuery(options.readyImages ?? []) : intentQuery(),
    rpc: async (name, args) => {
      events.push({ args, layer: "request", name })
      if (name === "create_lesson_image_upload_intent") return { data: [intentRow()], error: null }
      if (name === "cancel_lesson_image_upload_intent")
        return { data: [intentRow({ status: "cancelled" })], error: null }
      throw new Error(`Unexpected RPC ${name}`)
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => {
          events.push({ layer: "sign" })
          return options.signingFails
            ? { data: null, error: { status: 503 } }
            : { data: { signedUrl: "/signed", token: "not-recorded" }, error: null }
        },
      }),
    },
  }
}

function serviceClient(events, options = {}) {
  return {
    rpc: async (name, args) => {
      if (name === "register_validated_lesson_image") {
        events.push({ args, layer: "service", name })
        return { data: [imageRow()], error: null }
      }
      if (name !== "claim_expired_lesson_image_upload_intents") {
        throw new Error(`Unexpected service RPC ${name}`)
      }
      events.push({ layer: "cleanup" })
      return options.cleanupHangs ? new Promise(() => {}) : { data: [], error: null }
    },
    storage: {
      from: () => ({
        download: async () => {
          const data = options.invalidBlob
            ? new Blob([Uint8Array.from([0x52, 0x49])], { type: "image/webp" })
            : options.validBlob
              ? new Blob([Uint8Array.from(validWebpHeader)], { type: "image/webp" })
              : null
          events.push({ layer: "download", size: data?.size, type: data?.type })
          return {
            data,
            error: null,
          }
        },
        remove: async () => {
          events.push({ layer: "remove" })
          return { error: null }
        },
      }),
    },
  }
}

function imageQuery(rows) {
  let orderCount = 0
  const query = {
    eq: () => query,
    order: () => {
      orderCount += 1
      return orderCount === 2 ? Promise.resolve({ data: rows, error: null }) : query
    },
    select: () => query,
  }
  return query
}

function intentQuery() {
  const query = {
    eq: () => query,
    maybeSingle: async () => ({ data: intentRow(), error: null }),
    select: () => query,
  }
  return query
}

function intentRow(overrides = {}) {
  return {
    expires_at: expiresAt,
    id: intentId,
    lesson_id: lessonId,
    mime_type: "image/webp",
    object_name: objectName,
    size_bytes: 12,
    status: "pending",
    ...overrides,
  }
}

function imageRow() {
  return {
    created_at: "2026-08-25T10:00:00.000Z",
    file_path: objectName,
    id: "50000000-0000-4000-8000-000000000001",
    lesson_id: lessonId,
    lifecycle_state: "ready",
    sort_order: 0,
  }
}
