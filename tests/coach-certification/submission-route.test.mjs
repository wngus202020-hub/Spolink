import assert from "node:assert/strict"
import test from "node:test"

import "../profile-api/fixtures.mjs"

const sameOriginRequest = (body = "{}") =>
  new Request("http://localhost/api/coach-profile/me/submit", {
    body,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    method: "POST",
  })

test("Given a valid same-origin empty payload, when submitted, then response is private and no-store", async () => {
  const { createSubmitCoachApplicationRouteHandler } = await import(
    "../../lib/coach-certification/route-handlers.ts"
  )
  const handler = createSubmitCoachApplicationRouteHandler({
    createWorkflowDependencies: () => ({
      getVerifiedAuthUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
      submitCoachApplication: async () => ({
        application: {
          coachStatus: "submitted",
          profileRole: "learner",
          profileStatus: "pending_coach",
          submittedAt: "2026-08-13T00:00:00.000Z",
        },
        errorCode: null,
        errorMessage: null,
      }),
    }),
    isSupabaseConfigured: () => true,
  })

  const response = await handler(sameOriginRequest())

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal((await response.json()).data.profileStatus, "pending_coach")
})

test("Given cross-origin, wrong media, malformed, or client-controlled payloads, when submitted, then no workflow runs", async () => {
  const { createSubmitCoachApplicationRouteHandler } = await import(
    "../../lib/coach-certification/route-handlers.ts"
  )
  let calls = 0
  const handler = createSubmitCoachApplicationRouteHandler({
    createWorkflowDependencies: () => {
      calls += 1
      throw new Error("workflow must not be created")
    },
    isSupabaseConfigured: () => true,
  })
  const requests = [
    new Request("http://localhost/api/coach-profile/me/submit", {
      body: "{}",
      headers: { "content-type": "application/json", origin: "https://foreign.test" },
      method: "POST",
    }),
    new Request("http://localhost/api/coach-profile/me/submit", {
      body: "{}",
      headers: { "content-type": "text/plain", origin: "http://localhost" },
      method: "POST",
    }),
    sameOriginRequest("{"),
    sameOriginRequest(JSON.stringify({ status: "approved" })),
  ]

  const statuses = []
  for (const request of requests) statuses.push((await handler(request)).status)

  assert.deepEqual(statuses, [403, 415, 422, 422])
  assert.equal(calls, 0)
})
