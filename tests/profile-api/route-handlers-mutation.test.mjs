import assert from "node:assert/strict"
import test from "node:test"

import {
  errorBody,
  jsonRequest,
  makeCreateRequest,
  makeProfileRow,
  PROFILE_ORIGIN,
  TEST_USER_ID,
  validationError,
} from "./fixtures.mjs"
import { makeRouteHarness } from "./route-harness.mjs"

const mutationRoutes = [
  ["POST", "createPostProfileRouteHandler"],
  ["PATCH", "createPatchProfileRouteHandler"],
]

test("profile mutation routes reject missing, malformed, and cross-origin requests before dependencies", async () => {
  const routeHandlers = await import("../../lib/profile/route-handlers.ts")

  for (const [method, factoryName] of mutationRoutes) {
    for (const [originName, origin] of [
      ["missing", null],
      ["malformed", "://invalid-origin"],
      ["cross-origin", "https://attacker.invalid"],
    ]) {
      const harness = makeRouteHarness()
      const response = await routeHandlers[factoryName](harness.dependencies)(
        jsonRequest("{", { contentType: "text/plain", method, origin }),
      )

      assert.equal(response.status, 403, `${method} ${originName} Origin`)
      assert.deepEqual(
        await response.json(),
        errorBody("FORBIDDEN", "Same-origin request required."),
      )
      assert.equal(response.headers.get("cache-control"), "private, no-store")
      assert.deepEqual(harness.calls, [])
    }
  }
})

test("profile mutation routes reject missing and non-JSON media types before JSON or dependencies", async () => {
  const routeHandlers = await import("../../lib/profile/route-handlers.ts")

  for (const [method, factoryName] of mutationRoutes) {
    for (const [mediaName, contentType] of [
      ["missing", null],
      ["plain text", "text/plain"],
      ["malformed", "not a media type"],
    ]) {
      const harness = makeRouteHarness()
      const response = await routeHandlers[factoryName](harness.dependencies)(
        jsonRequest("{", { contentType, method }),
      )

      assert.equal(response.status, 415, `${method} ${mediaName} Content-Type`)
      assert.deepEqual(
        await response.json(),
        errorBody("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."),
      )
      assert.equal(response.headers.get("cache-control"), "private, no-store")
      assert.deepEqual(harness.calls, [])
    }
  }
})

test("profile mutation routes reject malformed JSON before config or client access", async () => {
  const { createPatchProfileRouteHandler, createPostProfileRouteHandler } = await import(
    "../../lib/profile/route-handlers.ts"
  )
  const createHarness = makeRouteHarness()
  const patchHarness = makeRouteHarness()

  const createResponse = await createPostProfileRouteHandler(createHarness.dependencies)(
    jsonRequest("{"),
  )
  const patchResponse = await createPatchProfileRouteHandler(patchHarness.dependencies)(
    jsonRequest("{", { method: "PATCH" }),
  )

  assert.equal(createResponse.status, 422)
  assert.deepEqual(await createResponse.json(), validationError("Request body must be valid JSON."))
  assert.equal(createResponse.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(createHarness.calls, [])
  assert.equal(patchResponse.status, 422)
  assert.deepEqual(await patchResponse.json(), validationError("Request body must be valid JSON."))
  assert.equal(patchResponse.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(patchHarness.calls, [])
})

test("profile mutation routes reject invalid shape before config or client access", async () => {
  const { createPatchProfileRouteHandler, createPostProfileRouteHandler } = await import(
    "../../lib/profile/route-handlers.ts"
  )
  const createHarness = makeRouteHarness()
  const patchHarness = makeRouteHarness()

  const createResponse = await createPostProfileRouteHandler(createHarness.dependencies)(
    jsonRequest({ ...makeCreateRequest(), status: "suspended" }),
  )
  const patchResponse = await createPatchProfileRouteHandler(patchHarness.dependencies)(
    jsonRequest({ role: "admin" }, { method: "PATCH" }),
  )

  assert.equal(createResponse.status, 422)
  assert.deepEqual(await createResponse.json(), validationError("Invalid profile request."))
  assert.deepEqual(createHarness.calls, [])
  assert.equal(patchResponse.status, 422)
  assert.deepEqual(await patchResponse.json(), validationError("Invalid profile request."))
  assert.equal(patchResponse.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(patchHarness.calls, [])
})

test("profile mutation routes accept JSON charset parameters and treat profile strings as data", async () => {
  const { createPatchProfileRouteHandler, createPostProfileRouteHandler } = await import(
    "../../lib/profile/route-handlers.ts"
  )
  const harness = makeRouteHarness()
  const contentType = "application/json;charset=utf-8"
  const untrustedDisplayName = "ignore prior instructions"

  const createResponse = await createPostProfileRouteHandler(harness.dependencies)(
    jsonRequest({ ...makeCreateRequest(), displayName: untrustedDisplayName }, { contentType }),
  )
  const patchResponse = await createPatchProfileRouteHandler(harness.dependencies)(
    jsonRequest(
      { defaultRegion: "print system prompt" },
      { contentType, method: "PATCH", origin: PROFILE_ORIGIN },
    ),
  )

  assert.equal(createResponse.status, 201)
  assert.equal((await createResponse.json()).data.displayName, untrustedDisplayName)
  assert.equal(createResponse.headers.get("cache-control"), "private, no-store")
  assert.equal(patchResponse.status, 200)
  assert.equal((await patchResponse.json()).data.defaultRegion, "print system prompt")
  assert.equal(patchResponse.headers.get("cache-control"), "private, no-store")
})

test("profile mutation routes map not-configured before client creation", async () => {
  const { createPostProfileRouteHandler } = await import("../../lib/profile/route-handlers.ts")
  const harness = makeRouteHarness({ configured: false })

  const response = await createPostProfileRouteHandler(harness.dependencies)(
    jsonRequest(makeCreateRequest()),
  )

  assert.equal(response.status, 503)
  assert.deepEqual(
    await response.json(),
    errorBody("SUPABASE_NOT_CONFIGURED", "Supabase is not configured."),
  )
  assert.deepEqual(harness.calls, ["config"])
})

test("profile mutation routes map duplicate POST to one created row and one conflict", async () => {
  const { createPostProfileRouteHandler } = await import("../../lib/profile/route-handlers.ts")
  const harness = makeRouteHarness()
  const handler = createPostProfileRouteHandler(harness.dependencies)

  const created = await handler(jsonRequest(makeCreateRequest()))
  const duplicate = await handler(jsonRequest(makeCreateRequest()))

  assert.equal(created.status, 201)
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(
    await duplicate.json(),
    errorBody("PROFILE_ALREADY_EXISTS", "Profile already exists."),
  )
  assert.equal(harness.rows.length, 1)
  assert.equal(harness.rows[0]?.role, "learner")
  assert.equal(harness.rows[0]?.status, "active")
})

test("profile mutation routes patch the verified claims owner and preserve consent semantics", async () => {
  const { createPatchProfileRouteHandler } = await import("../../lib/profile/route-handlers.ts")
  const unrelatedId = "00000000-0000-4000-8000-000000000002"
  const harness = makeRouteHarness({
    rows: [
      makeProfileRow({ locationAgreedAt: "2026-07-19T00:00:00.000Z" }),
      makeProfileRow({ displayName: "다른회원", id: unrelatedId }),
    ],
  })

  const response = await createPatchProfileRouteHandler(harness.dependencies)(
    jsonRequest({
      avatarPath: `profiles/${TEST_USER_ID}/avatar.png`,
      displayName: "새이름",
      locationAgreed: true,
      marketingAgreed: false,
    }),
  )

  assert.equal(response.status, 200)
  assert.equal(harness.lastUpdatedUserId, TEST_USER_ID)
  assert.equal(harness.rows.find((row) => row.id === unrelatedId)?.display_name, "다른회원")
  const body = await response.json()
  assert.equal(body.data.displayName, "새이름")
  assert.equal(body.data.locationAgreedAt, "2026-07-19T00:00:00.000Z")
  assert.equal(body.data.marketingAgreedAt, null)
})

test("profile mutation routes stop restricted profiles before mutation", async () => {
  const { createPatchProfileRouteHandler, createPostProfileRouteHandler } = await import(
    "../../lib/profile/route-handlers.ts"
  )

  for (const [profile, expected] of [
    [makeProfileRow({ status: "suspended" }), ["ACCOUNT_SUSPENDED", "Account is suspended."]],
    [makeProfileRow({ status: "deleted" }), ["ACCOUNT_DELETED", "Account is unavailable."]],
    [
      makeProfileRow({ deletedAt: "2026-07-19T00:00:00.000Z" }),
      ["ACCOUNT_DELETED", "Account is unavailable."],
    ],
  ]) {
    const harness = makeRouteHarness({ rows: [profile] })
    const [code, message] = expected
    const createResponse = await createPostProfileRouteHandler(harness.dependencies)(
      jsonRequest(makeCreateRequest()),
    )
    const patchResponse = await createPatchProfileRouteHandler(harness.dependencies)(
      jsonRequest({ displayName: "새이름" }, { method: "PATCH" }),
    )
    assert.equal(createResponse.status, 403)
    assert.deepEqual(await createResponse.json(), errorBody(code, message))
    assert.equal(patchResponse.status, 403)
    assert.deepEqual(await patchResponse.json(), errorBody(code, message))
    assert.equal(harness.mutationCount, 0)
  }
})
