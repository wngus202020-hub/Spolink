import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import "./profile-api/fixtures.mjs"

const reporterId = "66000000-0000-4000-8000-000000000001"
const targetId = "66200000-0000-4000-8000-000000000001"
const reportId = "66600000-0000-4000-8000-000000000001"

test("Given untrusted report input, when parsed, then message and server-owned fields are rejected", async () => {
  const { createReportSchema } = await import("../lib/trust-safety/contract.ts")

  const valid = createReportSchema.safeParse({
    detail: "  실제 장소 정보와 다릅니다.  ",
    reason: "  허위 정보  ",
    targetId,
    targetType: "lesson",
  })
  const message = createReportSchema.safeParse({
    reason: "unsupported",
    targetId,
    targetType: "message",
  })
  const forged = createReportSchema.safeParse({
    reason: "unsafe",
    reporterId,
    status: "resolved",
    targetId,
    targetType: "lesson",
  })

  assert.equal(valid.success, true)
  assert.deepEqual(valid.data, {
    detail: "실제 장소 정보와 다릅니다.",
    reason: "허위 정보",
    targetId,
    targetType: "lesson",
  })
  assert.equal(message.success, false)
  assert.equal(forged.success, false)
})

test("Given block and resolution input, when parsed, then self authority stays server-owned", async () => {
  const { createBlockSchema, resolveReportSchema } = await import("../lib/trust-safety/contract.ts")

  assert.equal(
    createBlockSchema.safeParse({ blockedId: targetId, blockerId: reporterId }).success,
    false,
  )
  assert.equal(
    resolveReportSchema.safeParse({
      action: "resolve",
      moderationAction: "hide_lesson",
      reviewedBy: reporterId,
      resolutionNote: "위반 확인",
    }).success,
    false,
  )
  assert.equal(
    resolveReportSchema.safeParse({
      action: "resolve",
      moderationAction: "hide_lesson",
      resolutionNote: "위반 확인",
    }).success,
    true,
  )
})

test("Given an active user, when report and block workflows run, then create and replay statuses are explicit", async () => {
  const { runCreateBlock, runCreateReport } = await import("../lib/trust-safety/workflow.ts")
  const report = reportData()
  const dependencies = userDependencies({
    createBlock: async () => ({
      data: {
        blockedId: targetId,
        createdAt: report.createdAt,
        id: "66700000-0000-4000-8000-000000000001",
        idempotent: true,
        reason: null,
      },
      errorCode: null,
    }),
    createReport: async () => ({ data: report, errorCode: null }),
  })

  const createdReport = await runCreateReport(
    { detail: null, reason: "허위 정보", targetId, targetType: "lesson" },
    dependencies,
  )
  const replayedBlock = await runCreateBlock({ blockedId: targetId, reason: null }, dependencies)

  assert.equal(createdReport.status, "success")
  assert.equal(createdReport.statusCode, 201)
  assert.equal(replayedBlock.status, "success")
  assert.equal(replayedBlock.statusCode, 200)
})

test("Given unauthorized or foreign repository results, when workflows run, then safe errors are returned", async () => {
  const { runCreateBlock, runCreateReport } = await import("../lib/trust-safety/workflow.ts")
  let writeCalled = false
  const unauthorized = await runCreateReport(
    { detail: null, reason: "unsafe", targetId, targetType: "lesson" },
    userDependencies({
      createReport: async () => {
        writeCalled = true
        return { data: reportData(), errorCode: null }
      },
      getAccess: async () => ({ kind: "unauthenticated" }),
    }),
  )
  const foreign = await runCreateBlock(
    { blockedId: targetId, reason: null },
    userDependencies({
      createBlock: async () => ({ data: null, errorCode: "42501" }),
    }),
  )

  assert.equal(writeCalled, false)
  assert.deepEqual(unauthorized, {
    error: { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
    status: "failure",
  })
  assert.deepEqual(foreign, {
    error: {
      code: "FORBIDDEN",
      message: "Trust and safety request is forbidden.",
      statusCode: 403,
    },
    status: "failure",
  })
})

test("Given report routes, when malformed, message, duplicate, and valid requests run, then boundaries are deterministic", async () => {
  const { createCreateReportRouteHandler } = await import("../lib/trust-safety/route-handlers.ts")
  let dependencyCalls = 0
  const dependencies = {
    createWorkflowDependencies: async () => {
      dependencyCalls += 1
      return userDependencies({
        createReport: async (input) =>
          input.reason === "duplicate"
            ? { data: null, errorCode: "23505" }
            : { data: reportData(), errorCode: null },
      })
    },
    isSupabaseConfigured: () => true,
  }
  const handler = createCreateReportRouteHandler(dependencies)

  const crossOrigin = await handler(jsonRequest("/api/reports", {}, "https://evil.test"))
  const malformed = await handler(rawRequest("/api/reports", "{"))
  const message = await handler(
    jsonRequest("/api/reports", { reason: "unsafe", targetId, targetType: "message" }),
  )
  const duplicate = await handler(
    jsonRequest("/api/reports", { reason: "duplicate", targetId, targetType: "lesson" }),
  )
  const valid = await handler(
    jsonRequest("/api/reports", { reason: "unsafe", targetId, targetType: "lesson" }),
  )

  assert.deepEqual(
    [crossOrigin.status, malformed.status, message.status, duplicate.status, valid.status],
    [403, 422, 422, 409, 201],
  )
  assert.equal(dependencyCalls, 2)
  assert.equal(valid.headers.get("cache-control"), "private, no-store")
})

test("Given admin report resolution, when active and inactive claims run, then only active admin reaches RPC", async () => {
  const { createResolveAdminReportRouteHandler } = await import(
    "../lib/trust-safety/admin-route-handlers.ts"
  )
  let active = false
  let resolutions = 0
  const handler = createResolveAdminReportRouteHandler({
    createWorkflowDependencies: async () => ({
      getAccess: async () =>
        active ? { kind: "admin", userId: reporterId } : { kind: "user", userId: reporterId },
      resolveReport: async () => {
        resolutions += 1
        return {
          data: {
            idempotent: false,
            moderationAction: "hide_lesson",
            reportId,
            reviewedAt: "2026-08-14T00:00:00.000Z",
            status: "resolved",
          },
          errorCode: null,
        }
      },
    }),
    isSupabaseConfigured: () => true,
  })
  const context = { params: Promise.resolve({ reportId }) }
  const requestBody = {
    action: "resolve",
    moderationAction: "hide_lesson",
    resolutionNote: "위반 확인",
  }

  const forbidden = await handler(
    jsonRequest(`/api/admin/reports/${reportId}/resolve`, requestBody),
    context,
  )
  active = true
  const resolved = await handler(
    jsonRequest(`/api/admin/reports/${reportId}/resolve`, requestBody),
    context,
  )

  assert.deepEqual([forbidden.status, resolved.status], [403, 200])
  assert.equal(resolutions, 1)
})

test("Given the trust migration, when inspected, then direct writes, locks, audit redaction, and downstream gates are DB-owned", async () => {
  const migration = await readFile(
    "supabase/migrations/20260814100000_add_trust_safety_workflows.sql",
    "utf8",
  )

  assert.match(migration, /create or replace function public\.create_report/u)
  assert.match(migration, /create or replace function public\.create_block/u)
  assert.match(migration, /create or replace function public\.resolve_report/u)
  assert.match(migration, /from public\.reports[\s\S]*for update/u)
  assert.match(migration, /insert into public\.audit_logs/u)
  assert.match(migration, /jsonb_build_object\([\s\S]*'moderationAction'/u)
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]*'(reason|detail|email|phone)'/u)
  assert.match(migration, /public\.users_have_block\(auth\.uid\(\), selected_coach_user_id\)/u)
  assert.doesNotMatch(migration, /update public\.reservations[\s\S]*status = 'confirmed'/u)
})

test("Given the admin report UI, when inspected, then list, empty, action, stale, and busy states are present", async () => {
  const [listPage, detailPage, actions] = await Promise.all([
    readFile("app/admin/reports/page.tsx", "utf8"),
    readFile("app/admin/reports/[reportId]/page.tsx", "utf8"),
    readFile("components/admin/report-resolution-actions.tsx", "utf8"),
  ])

  assert.match(listPage, /해당 상태의 신고가 없습니다/u)
  assert.match(listPage, /AdminReportStatusBadge/u)
  assert.match(detailPage, /ReportResolutionActions/u)
  assert.match(actions, /명시적 조치/u)
  assert.match(actions, /다른 관리자가 먼저 상태를 변경했습니다/u)
  assert.match(actions, /disabled=\{disabled\}/u)
})

function reportData() {
  return {
    createdAt: "2026-08-14T00:00:00.000Z",
    detail: null,
    id: reportId,
    moderationAction: null,
    reason: "unsafe",
    resolutionNote: null,
    reviewedAt: null,
    status: "submitted",
    targetId,
    targetType: "lesson",
  }
}

function userDependencies(overrides = {}) {
  return {
    createBlock: async () => ({ data: null, errorCode: "INTERNAL_ERROR" }),
    createReport: async () => ({ data: null, errorCode: "INTERNAL_ERROR" }),
    getAccess: async () => ({ kind: "user", userId: reporterId }),
    listBlocks: async () => ({
      data: { items: [], page: 1, pageSize: 20, total: 0 },
      errorCode: null,
    }),
    listReports: async () => ({
      data: { items: [], page: 1, pageSize: 20, total: 0 },
      errorCode: null,
    }),
    ...overrides,
  }
}

function jsonRequest(path, body, origin = "http://localhost") {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  })
}

function rawRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    body,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    method: "POST",
  })
}
