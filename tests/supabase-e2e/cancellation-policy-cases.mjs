export const slotSuffixes = Object.freeze({
  actorFull: "413",
  idempotent: "415",
  learner50: "411",
  learner70: "410",
  learnerZero: "412",
  pending: "414",
})

export const learnerRefundCases = Object.freeze([
  {
    name: "slot 410 learner cancellation at 25h returns 7000",
    refund: 7000,
    slotKey: "learner70",
  },
  {
    name: "slot 411 learner cancellation at 4h returns 5000",
    refund: 5000,
    slotKey: "learner50",
  },
  {
    name: "slot 412 learner cancellation at 2h returns no refund",
    refund: null,
    slotKey: "learnerZero",
  },
])

export const actorFullRefundCases = Object.freeze([
  { actor: "coach", recipients: ["learner"], status: "cancelled_by_coach" },
  { actor: "admin", recipients: ["learner", "coach"], status: "cancelled_by_admin" },
])

export const pendingPaymentCases = Object.freeze([
  { actor: "learner", recipients: ["coach"], status: "cancelled_by_user" },
  { actor: "admin", recipients: ["learner", "coach"], status: "cancelled_by_admin" },
])

export const deniedCases = Object.freeze([
  {
    actor: "otherLearner",
    code: "FORBIDDEN",
    name: "unrelated learner",
    slotKey: "learner70",
    status: 403,
    testName: "unrelated learner cancellation returns 403 FORBIDDEN and rolls back",
  },
  {
    actor: "coach",
    code: "FORBIDDEN",
    name: "unauthorized coach",
    options: { coachProfileId: "pendingCoachProfile" },
    slotKey: "learner70",
    status: 403,
    testName: "unauthorized coach cancellation returns 403 FORBIDDEN and rolls back",
  },
  {
    actor: "pendingCoach",
    code: "FORBIDDEN",
    name: "pending coach",
    options: { coachProfileId: "pendingCoachProfile" },
    slotKey: "learner70",
    status: 403,
    testName: "pending coach cancellation returns 403 FORBIDDEN and rolls back",
  },
  {
    actor: "learner",
    code: "NOT_FOUND",
    name: "missing reservation",
    options: { missing: true },
    slotKey: "learner70",
    status: 404,
    testName: "missing reservation cancellation returns 404 NOT_FOUND and rolls back",
  },
  {
    actor: "learner",
    code: "INVALID_STATE_TRANSITION",
    name: "invalid state",
    options: { reservation: { status: "completed" } },
    slotKey: "learner70",
    status: 409,
    testName: "invalid state cancellation returns 409 INVALID_STATE_TRANSITION and rolls back",
  },
  {
    actor: "coach",
    code: "INVALID_STATE_TRANSITION",
    name: "coach pending-payment invalid state",
    slotKey: "pending",
    status: 409,
    testName:
      "coach pending-payment invalid state cancellation returns 409 INVALID_STATE_TRANSITION and rolls back",
  },
  {
    actor: null,
    code: "UNAUTHORIZED",
    name: "unauthenticated",
    slotKey: "learner70",
    status: 401,
    testName: "unauthenticated cancellation returns 401 and rolls back",
  },
  {
    actor: "learner",
    code: "VALIDATION_ERROR",
    name: "malformed body",
    options: { raw: "{" },
    slotKey: "learner70",
    status: 422,
    testName: "malformed body returns 422 and rolls back before RPC side effects",
  },
  {
    actor: "learner",
    code: "ACCOUNT_SUSPENDED",
    name: "suspended learner",
    options: { profile: ["suspended", null] },
    slotKey: "learner70",
    status: 403,
    testName: "suspended learner mutation returns 403 and profile is restored before next case",
  },
  {
    actor: "learner",
    code: "ACCOUNT_DELETED",
    name: "deleted learner",
    options: { profile: ["deleted", new Date(0).toISOString()] },
    slotKey: "learner70",
    status: 403,
    testName: "deleted learner mutation returns 403 and profile is restored before next case",
  },
])
