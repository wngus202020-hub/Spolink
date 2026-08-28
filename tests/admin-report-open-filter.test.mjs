import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import "./profile-api/fixtures.mjs"

const reportRow = {
  created_at: "2026-08-27T00:00:00.000Z",
  detail: null,
  id: "66600000-0000-4000-8000-000000000001",
  moderation_action: null,
  reason: "신고 사유",
  reporter_id: "66000000-0000-4000-8000-000000000001",
  resolution_note: null,
  reviewed_at: null,
  reviewed_by: null,
  status: "submitted",
  target_id: "66200000-0000-4000-8000-000000000001",
  target_type: "lesson",
  updated_at: "2026-08-27T00:00:00.000Z",
}

test("Given all and a stored report status, when parsed and listed, then all has no predicate and the stored status uses equality", async () => {
  const { parseAdminReportQuery } = await import("../lib/trust-safety/contract.ts")
  const { createAdminTrustSafetyDependencies } = await import("../lib/trust-safety/repository.ts")
  const filters = await readFile("app/admin/reports/page.tsx", "utf8")
  const calls = []
  const repository = createAdminTrustSafetyDependencies(createFluentClient(calls))

  const all = parseAdminReportQuery(
    new URL("/admin/reports?status=all&page=1&pageSize=20", "http://local").searchParams,
  )
  const submitted = parseAdminReportQuery(
    new URL("/admin/reports?status=submitted&page=1&pageSize=20", "http://local").searchParams,
  )
  assert.deepEqual(all, { page: 1, pageSize: 20, status: "all" })
  assert.deepEqual(submitted, { page: 1, pageSize: 20, status: "submitted" })

  await repository.listReports(all)
  await repository.listReports(submitted)

  assert.deepEqual(calls, [{ type: "eq", values: ["status", "submitted"] }])
  assert.match(filters, /\{ label: "전체", status: "all" \}/u)
  assert.match(filters, /\{ label: "접수", status: "submitted" \}/u)
  assert.match(filters, /: `\/admin\/reports\?status=\$\{filter\.status\}`/u)
})

test("Given the synthetic open report filter, when parsed and listed, then exactly submitted and reviewing use an IN predicate", async () => {
  const { parseAdminReportQuery } = await import("../lib/trust-safety/contract.ts")
  const { createAdminTrustSafetyDependencies } = await import("../lib/trust-safety/repository.ts")
  const filters = await readFile("app/admin/reports/page.tsx", "utf8")
  const calls = []
  const repository = createAdminTrustSafetyDependencies(createFluentClient(calls))

  const open = parseAdminReportQuery(
    new URL("/admin/reports?status=open&page=1&pageSize=20", "http://local").searchParams,
  )
  assert.deepEqual(open, { page: 1, pageSize: 20, status: "open" })

  await repository.listReports(open)

  assert.deepEqual(calls, [{ type: "in", values: ["status", ["submitted", "reviewing"]] }])
  assert.equal(
    parseAdminReportQuery(
      new URL("/admin/reports?status=open%2Cresolved&page=1&pageSize=20", "http://local")
        .searchParams,
    ),
    null,
  )
  assert.equal(
    parseAdminReportQuery(
      new URL("/admin/reports?status=open&status=resolved&page=1&pageSize=20", "http://local")
        .searchParams,
    ),
    null,
  )
  assert.equal(
    parseAdminReportQuery(
      new URL("/admin/reports?status=open&status=open&page=1&pageSize=20", "http://local")
        .searchParams,
    ),
    null,
  )
  assert.equal(
    parseAdminReportQuery(
      new URL("/admin/reports?status=unknown&page=1&pageSize=20", "http://local").searchParams,
    ),
    null,
  )
  assert.match(filters, /\{ label: "처리 필요", status: "open" \}/u)
  assert.match(filters, /`\/admin\/reports\?status=open&page=1&pageSize=\$\{query\.pageSize\}`/u)
})

test("Given each stored report status, when listed, then each uses an equality predicate", async () => {
  const { createAdminTrustSafetyDependencies } = await import("../lib/trust-safety/repository.ts")
  const calls = []
  const repository = createAdminTrustSafetyDependencies(createFluentClient(calls))

  for (const status of ["submitted", "reviewing", "resolved", "rejected"]) {
    await repository.listReports({ page: 1, pageSize: 20, status })
  }

  assert.deepEqual(calls, [
    { type: "eq", values: ["status", "submitted"] },
    { type: "eq", values: ["status", "reviewing"] },
    { type: "eq", values: ["status", "resolved"] },
    { type: "eq", values: ["status", "rejected"] },
  ])
})

function createFluentClient(calls) {
  const request = Promise.resolve({ count: 1, data: [reportRow], error: null })
  request.eq = (column, value) => {
    calls.push({ type: "eq", values: [column, value] })
    return request
  }
  request.in = (column, values) => {
    calls.push({ type: "in", values: [column, values] })
    return request
  }
  request.order = () => request
  request.range = () => request
  request.select = () => request

  return {
    from() {
      return request
    },
  }
}
