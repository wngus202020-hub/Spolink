import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import ts from "typescript"

import { runPreparePaymentWorkflow } from "../../lib/payments/prepare-payment-api.ts"
import { runCancelReservationWorkflow } from "../../lib/reservations/cancel-reservation-api.ts"
import { createCancelReservationRouteAdapter } from "../../lib/reservations/cancel-reservation-route-adapter.ts"
import { runCreateReservationWorkflow } from "../../lib/reservations/create-reservation-api.ts"

const userId = "00000000-0000-4000-8000-000000000001"
const reservationId = "00000000-0000-4000-8000-000000000401"

const createReservationRequest = Object.freeze({
  lessonId: "00000000-0000-4000-8000-000000000101",
  lessonScheduleId: "00000000-0000-4000-8000-000000000301",
})

const preparePaymentRequest = Object.freeze({ reservationId })
const cancelReservationRequest = Object.freeze({ reason: "일정 변경", reservationId })

test("reservation creation returns profile-required before downstream RPC when authenticated user has no profile", async () => {
  // Given: an authenticated user whose profile row does not exist.
  const calls = []

  // When: the reservation workflow runs.
  const result = await runCreateReservationWorkflow(createReservationRequest, {
    createPendingReservation: async () => {
      calls.push("rpc")
      return { errorCode: null, reservation: pendingReservation() }
    },
    getCurrentProfile: async (targetUserId) => {
      calls.push(`profile:${targetUserId}`)
      return { errorCode: null, profile: null }
    },
    getVerifiedAuthUser: async () => {
      calls.push("auth")
      return { id: userId }
    },
    hasAuthenticatedUser: async () => {
      calls.push("legacy-auth")
      return true
    },
  })

  // Then: the missing profile is reported before any mutation RPC can run.
  assert.deepEqual(result, {
    error: { code: "PROFILE_REQUIRED", message: "Profile setup required.", statusCode: 409 },
    status: "failure",
  })
  assert.deepEqual(calls, ["auth", `profile:${userId}`])
})

test("payment prepare returns restricted account errors before downstream RPC", async () => {
  for (const [profile, expected] of [
    [profileRow({ status: "suspended" }), ["ACCOUNT_SUSPENDED", "Account is suspended."]],
    [profileRow({ status: "deleted" }), ["ACCOUNT_DELETED", "Account is unavailable."]],
    [
      profileRow({ deleted_at: "2026-07-19T00:00:00.000Z" }),
      ["ACCOUNT_DELETED", "Account is unavailable."],
    ],
  ]) {
    // Given: an authenticated user with a restricted profile state.
    const calls = []

    // When: payment preparation runs.
    const result = await runPreparePaymentWorkflow(preparePaymentRequest, {
      createReadyPayment: async () => {
        calls.push("rpc")
        return { errorCode: null, payment: readyPayment() }
      },
      getCurrentProfile: async () => {
        calls.push("profile")
        return { errorCode: null, profile }
      },
      getVerifiedAuthUser: async () => {
        calls.push("auth")
        return { id: userId }
      },
      hasAuthenticatedUser: async () => {
        calls.push("legacy-auth")
        return true
      },
    })

    // Then: the exact account error is returned before the payment RPC.
    const [code, message] = expected
    assert.deepEqual(result, { error: { code, message, statusCode: 403 }, status: "failure" })
    assert.deepEqual(calls, ["auth", "profile"])
  }
})

test("reservation cancellation preserves downstream RPC behavior for allowed profile statuses", async () => {
  for (const status of ["active", "pending_coach", "coach_approved"]) {
    // Given: an authenticated user with an allowed profile status.
    const calls = []

    // When: the cancellation workflow runs.
    const result = await runCancelReservationWorkflow(cancelReservationRequest, {
      cancelReservation: async (args) => {
        calls.push(args)
        return { cancellation: cancellationRow(), errorCode: null }
      },
      getCurrentProfile: async () => ({ errorCode: null, profile: profileRow({ status }) }),
      getVerifiedAuthUser: async () => ({ id: userId }),
      hasAuthenticatedUser: async () => true,
    })

    // Then: existing RPC behavior is preserved after the profile precondition passes.
    assert.equal(result.status, "success")
    assert.deepEqual(calls, [
      { checked_reason: "일정 변경", checked_reservation_id: reservationId },
    ])
  }
})

test("malformed cancellation JSON is rejected before config, session, auth, profile, or RPC access", async () => {
  // Given: a cancellation adapter with every downstream dependency instrumented.
  const calls = []
  const adapter = createCancelReservationRouteAdapter({
    createSession: async () => {
      calls.push("session")
      return {
        cancelReservation: async () => {
          calls.push("rpc")
          return { cancellation: cancellationRow(), errorCode: null }
        },
        getCurrentProfile: async () => {
          calls.push("profile")
          return { errorCode: null, profile: profileRow() }
        },
        getVerifiedAuthUser: async () => {
          calls.push("auth")
          return { id: userId }
        },
        hasAuthenticatedUser: async () => {
          calls.push("legacy-auth")
          return true
        },
      }
    },
    getConfigStatus: () => {
      calls.push("config")
      return { configured: true }
    },
    parseRequest: () => ({ request: cancelReservationRequest, status: "success" }),
    respond: (body, init) => Response.json(body, init),
    runWorkflow: runCancelReservationWorkflow,
  })

  // When: malformed JSON reaches the route boundary.
  const response = await adapter(
    new Request(`http://localhost/api/reservations/${reservationId}/cancel`, {
      body: "{",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      method: "POST",
    }),
    reservationId,
  )

  // Then: JSON parsing wins and no access dependency runs.
  assert.equal(response.status, 422)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION_ERROR",
      details: [],
      message: "Request body must be valid JSON.",
    },
  })
  assert.deepEqual(calls, [])
})

test("payment confirm route AST keeps edge authorization before service access", async () => {
  // Given: the TypeScript AST for the payment-confirm route boundary.
  const source = await readFile("app/api/payments/confirm/route.ts", "utf8")
  const sourceFile = ts.createSourceFile(
    "route.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const post = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "POST" && statement.body,
  )
  assert.ok(post && ts.isFunctionDeclaration(post) && post.body)

  // When: top-level guards and referenced identifiers are derived structurally.
  const guards = post.body.statements.map(guardCallName).filter((name) => name !== null)
  const identifiers = collectIdentifierNames(sourceFile)

  // Then: edge configuration and authorization precede service/provider access, with no user path.
  assert.ok(guards.indexOf("getEdgeRuntimeConfigStatus") >= 0)
  assert.ok(
    guards.indexOf("isAuthorizedEdgeRequest") > guards.indexOf("getEdgeRuntimeConfigStatus"),
  )
  assert.ok(
    guards.indexOf("getSupabaseServiceConfigStatus") > guards.indexOf("isAuthorizedEdgeRequest"),
  )
  for (const forbidden of [
    "profiles",
    "getUser",
    "getClaims",
    "cookies",
    "createSupabaseServerClient",
  ]) {
    assert.equal(identifiers.has(forbidden), false, `forbidden route dependency: ${forbidden}`)
  }
})

function guardCallName(statement) {
  if (!ts.isIfStatement(statement)) return null
  const expression = ts.isPrefixUnaryExpression(statement.expression)
    ? statement.expression.operand
    : statement.expression
  if (!ts.isCallExpression(expression) && !ts.isPropertyAccessExpression(expression)) return null
  const call = ts.isPropertyAccessExpression(expression) ? expression.expression : expression
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return null
  return call.expression.text
}

function collectIdentifierNames(sourceFile) {
  const names = new Set()
  const visit = (node) => {
    if (ts.isIdentifier(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

function profileRow(overrides = {}) {
  return {
    avatar_path: null,
    default_region: "서울 강남구",
    deleted_at: null,
    display_name: "홍길동",
    id: userId,
    location_agreed_at: null,
    marketing_agreed_at: null,
    phone: "010-1234-5678",
    real_name: "홍길동",
    role: "learner",
    status: "active",
    ...overrides,
  }
}

function pendingReservation() {
  return {
    id: reservationId,
    payment_expires_at: "2026-08-01T09:10:00+09:00",
    reserved_price_amount: 50000,
    status: "pending_payment",
  }
}

function readyPayment() {
  return {
    amount: 50000,
    order_name: "입문 테니스 레슨",
    payment_id: "00000000-0000-4000-8000-000000000501",
    provider: "toss",
    provider_order_id: `spolink_${reservationId}`,
  }
}

function cancellationRow() {
  return {
    cancelled_at: "2026-08-01T09:00:00+09:00",
    refund_amount: null,
    refund_id: null,
    refund_status: null,
    reservation_id: reservationId,
    reservation_status: "cancelled_by_user",
  }
}
