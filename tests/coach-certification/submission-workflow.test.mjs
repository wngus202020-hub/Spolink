import assert from "node:assert/strict"
import test from "node:test"

const USER_ID = "00000000-0000-4000-8000-000000000001"

test("Given a verified learner and valid application, when submitted, then the paired tuple is returned", async () => {
  const { runSubmitCoachApplicationWorkflow } = await import(
    "../../lib/coach-certification/submission.ts"
  )
  const calls = []

  const result = await runSubmitCoachApplicationWorkflow({
    getVerifiedAuthUser: async () => ({ id: USER_ID }),
    submitCoachApplication: async () => {
      calls.push(USER_ID)
      return {
        application: {
          coachStatus: "submitted",
          profileRole: "learner",
          profileStatus: "pending_coach",
          submittedAt: "2026-08-13T00:00:00.000Z",
        },
        errorCode: null,
        errorMessage: null,
      }
    },
  })

  assert.deepEqual(calls, [USER_ID])
  assert.deepEqual(result, {
    response: {
      data: {
        coachStatus: "submitted",
        profileRole: "learner",
        profileStatus: "pending_coach",
        submittedAt: "2026-08-13T00:00:00.000Z",
      },
    },
    status: "success",
    statusCode: 200,
  })
})

test("Given no verified claims, when submitted, then the RPC is not called", async () => {
  const { runSubmitCoachApplicationWorkflow } = await import(
    "../../lib/coach-certification/submission.ts"
  )
  let called = false

  const result = await runSubmitCoachApplicationWorkflow({
    getVerifiedAuthUser: async () => null,
    submitCoachApplication: async () => {
      called = true
      return { application: null, errorCode: null, errorMessage: null }
    },
  })

  assert.equal(called, false)
  assert.equal(result.status, "failure")
  assert.deepEqual(result.error, {
    code: "UNAUTHORIZED",
    message: "Authentication required.",
    statusCode: 401,
  })
})

test("Given rejected RPC preconditions, when submitted, then stable API errors are returned", async () => {
  const { runSubmitCoachApplicationWorkflow } = await import(
    "../../lib/coach-certification/submission.ts"
  )
  const cases = [
    ["COACH_APPLICATION_INCOMPLETE", 422],
    ["COACH_CERTIFICATE_REQUIRED", 422],
    ["COACH_CERTIFICATE_INVALID", 422],
    ["COACH_APPLICATION_CONFLICT", 409],
    ["ACCOUNT_SUSPENDED", 403],
    ["ACCOUNT_DELETED", 403],
    ["COACH_APPLICATION_NOT_FOUND", 404],
  ]

  for (const [errorMessage, statusCode] of cases) {
    const result = await runSubmitCoachApplicationWorkflow({
      getVerifiedAuthUser: async () => ({ id: USER_ID }),
      submitCoachApplication: async () => ({
        application: null,
        errorCode: "P0001",
        errorMessage,
      }),
    })

    assert.equal(result.status, "failure")
    assert.equal(result.error.code, errorMessage)
    assert.equal(result.error.statusCode, statusCode)
  }
})
