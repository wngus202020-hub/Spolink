import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

const projectRootUrl = new URL("../", import.meta.url).href
register(
  `data:text/javascript,${encodeURIComponent(`
    const projectRootUrl = ${JSON.stringify(projectRootUrl)}
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return nextResolve(new URL(specifier.slice(2) + ".ts", projectRootUrl).href, context)
      }
      try {
        return await nextResolve(specifier, context)
      } catch (error) {
        if (error && error.code === "ERR_MODULE_NOT_FOUND" && /^(?:\\.\\.?\\/)/.test(specifier)) {
          return nextResolve(specifier + ".ts", context)
        }
        throw error
      }
    }
  `)}`,
  import.meta.url,
)

const { createFavoriteMutationRouteHandler } = await import(
  "../lib/favorites/mutation-route-handler.ts"
)
const { parseFavoriteMutationRequest, runFavoriteMutationWorkflow } = await import(
  "../lib/favorites/mutation-workflow.ts"
)

const learnerId = "10000000-0000-4000-8000-000000000001"
const lessonId = "20000000-0000-4000-8000-000000000001"

test("Given malformed or client-owned fields, when parsed, then favorite input is rejected", () => {
  assert.equal(parseFavoriteMutationRequest({ lessonId: "not-an-id" }).status, "failure")
  assert.equal(
    parseFavoriteMutationRequest({ learnerId, lessonId, status: "active" }).status,
    "failure",
  )
  assert.deepEqual(parseFavoriteMutationRequest({ lessonId }), {
    request: { lessonId },
    status: "success",
  })
})

test("Given a foreign role, when favorite mutation runs, then persistence is not reached", async () => {
  let mutationCalls = 0
  const result = await runFavoriteMutationWorkflow(
    { action: "add", request: { lessonId }, userId: learnerId },
    {
      getCurrentProfile: async () => ({
        errorCode: null,
        profile: { deletedAt: null, role: "coach", status: "active" },
      }),
      mutateFavorite: async () => {
        mutationCalls += 1
        return { errorCode: null, row: { changed: true, lessonId } }
      },
    },
  )

  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "FORBIDDEN")
  assert.equal(mutationCalls, 0)
})

test("Given duplicate POST and repeated DELETE, when workflows replay, then results are idempotent", async () => {
  const profile = {
    errorCode: null,
    profile: { deletedAt: null, role: "learner", status: "active" },
  }
  const addReplay = await runFavoriteMutationWorkflow(
    { action: "add", request: { lessonId }, userId: learnerId },
    {
      getCurrentProfile: async () => profile,
      mutateFavorite: async () => ({ errorCode: null, row: { changed: false, lessonId } }),
    },
  )
  const removeReplay = await runFavoriteMutationWorkflow(
    { action: "remove", request: { lessonId }, userId: learnerId },
    {
      getCurrentProfile: async () => profile,
      mutateFavorite: async () => ({ errorCode: null, row: { changed: false, lessonId } }),
    },
  )

  assert.deepEqual(addReplay, {
    response: { data: { changed: false, favorited: true, lessonId } },
    status: "success",
    statusCode: 200,
  })
  assert.deepEqual(removeReplay, {
    response: { data: { changed: false, favorited: false, lessonId } },
    status: "success",
    statusCode: 200,
  })
})

test("Given an inactive lesson RPC result, when add runs, then the typed conflict is preserved", async () => {
  const result = await runFavoriteMutationWorkflow(
    { action: "add", request: { lessonId }, userId: learnerId },
    {
      getCurrentProfile: async () => ({
        errorCode: null,
        profile: { deletedAt: null, role: "learner", status: "active" },
      }),
      mutateFavorite: async () => ({ errorCode: "FAVORITE_LESSON_NOT_ACTIVE", row: null }),
    },
  )

  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "LESSON_NOT_ACTIVE")
  assert.equal(result.error.statusCode, 409)
})

test("Given adversarial requests, when the route handles them, then boundary precedence is exact", async () => {
  const calls = []
  const handler = createFavoriteMutationRouteHandler("add", {
    createSession: async () => {
      calls.push("session")
      return {
        getVerifiedUserId: async () => {
          calls.push("claims")
          return learnerId
        },
        workflowDependencies: workflowDependencies(),
      }
    },
    isConfigured: () => {
      calls.push("configured")
      return true
    },
    runWorkflow: async () => {
      calls.push("workflow")
      return {
        response: { data: { changed: true, favorited: true, lessonId } },
        status: "success",
        statusCode: 201,
      }
    },
  })

  const cases = [
    request({ body: "{}", contentType: "application/json", origin: "https://foreign.test" }),
    request({ body: "{}", contentType: "text/plain" }),
    request({ body: "{", contentType: "application/json" }),
    request({ body: "{}", contentType: "application/json" }),
  ]
  const statuses = []
  for (const current of cases) {
    const response = await handler(current)
    statuses.push(response.status)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
  }

  assert.deepEqual(statuses, [403, 415, 422, 422])
  assert.deepEqual(calls, [])

  const valid = await handler(
    request({ body: JSON.stringify({ lessonId }), contentType: "application/json" }),
  )
  assert.equal(valid.status, 201)
  assert.deepEqual(calls, ["configured", "session", "claims", "workflow"])
})

test("Given missing claims, when the route handles a valid request, then workflow is not reached", async () => {
  let workflowCalls = 0
  const handler = createFavoriteMutationRouteHandler("remove", {
    createSession: async () => ({
      getVerifiedUserId: async () => null,
      workflowDependencies: workflowDependencies(),
    }),
    isConfigured: () => true,
    runWorkflow: async () => {
      workflowCalls += 1
      throw new Error("workflow must not run")
    },
  })
  const response = await handler(
    request({ body: JSON.stringify({ lessonId }), contentType: "application/json" }),
  )

  assert.equal(response.status, 401)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(workflowCalls, 0)
})

test("Given valid input but missing configuration, when handled, then session and claims are untouched", async () => {
  let sessionCalls = 0
  const handler = createFavoriteMutationRouteHandler("add", {
    createSession: async () => {
      sessionCalls += 1
      throw new Error("session must not be created")
    },
    isConfigured: () => false,
    runWorkflow: async () => {
      throw new Error("workflow must not run")
    },
  })
  const response = await handler(
    request({ body: JSON.stringify({ lessonId }), contentType: "application/json" }),
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(sessionCalls, 0)
})

function request({ body, contentType, origin = "https://spolink.test" }) {
  const headers = { Origin: origin }
  if (contentType) headers["Content-Type"] = contentType
  return new Request("https://spolink.test/api/favorites", { body, headers, method: "POST" })
}

function workflowDependencies() {
  return {
    getCurrentProfile: async () => ({
      errorCode: null,
      profile: { deletedAt: null, role: "learner", status: "active" },
    }),
    mutateFavorite: async () => ({ errorCode: null, row: { changed: true, lessonId } }),
  }
}
