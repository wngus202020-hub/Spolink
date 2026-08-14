import assert from "node:assert/strict"
import test from "node:test"

import { errorBody, makeProfileRow } from "./fixtures.mjs"
import { makeRouteHarness } from "./route-harness.mjs"

test("profile GET route maps status outcomes and no-store/cookie headers", async () => {
  const { createGetCurrentProfileRouteHandler } = await import(
    "../../lib/profile/route-handlers.ts"
  )

  const unauthorized = await createGetCurrentProfileRouteHandler(
    makeRouteHarness({ user: null }).dependencies,
  )()
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(await unauthorized.json(), errorBody("UNAUTHORIZED", "Authentication required."))

  const missingProfile = await createGetCurrentProfileRouteHandler(
    makeRouteHarness().dependencies,
  )()
  assert.equal(missingProfile.status, 409)
  assert.equal(missingProfile.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(
    await missingProfile.json(),
    errorBody("PROFILE_REQUIRED", "Profile setup required."),
  )

  const activeHarness = makeRouteHarness({
    rows: [makeProfileRow({ locationAgreedAt: "2026-07-19T00:00:00.000Z" })],
    setCookie: "spolink-session=refreshed; Path=/; HttpOnly",
  })
  const active = await createGetCurrentProfileRouteHandler(activeHarness.dependencies)()
  assert.equal(active.status, 200)
  assert.equal(active.headers.get("cache-control"), "private, no-store")
  assert.equal(active.headers.get("set-cookie"), "spolink-session=refreshed; Path=/; HttpOnly")
  assert.deepEqual(Object.keys((await active.json()).data), [
    "id",
    "role",
    "status",
    "displayName",
    "realName",
    "phone",
    "avatarPath",
    "defaultRegion",
    "locationAgreedAt",
    "marketingAgreedAt",
    "deletedAt",
    "coachProfile",
  ])
})

test("profile route handlers hide private database failures at the HTTP boundary", async () => {
  const { createGetCurrentProfileRouteHandler } = await import(
    "../../lib/profile/route-handlers.ts"
  )
  const response = await createGetCurrentProfileRouteHandler(
    makeRouteHarness({
      coachErrorCode: "42P01",
      rows: [makeProfileRow()],
    }).dependencies,
  )()
  const body = await response.json()
  const serialized = JSON.stringify(body)

  assert.equal(response.status, 500)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(body, errorBody("INTERNAL_ERROR", "Unable to complete profile request."))
  assert.equal(serialized.includes("42P01"), false)
  assert.equal(serialized.includes("relation"), false)
  assert.equal(serialized.includes("stack"), false)
})
