import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const reservationId = "66000000-0000-4000-8000-000000000001"

test("admin reservation workflow rejects anonymous and non-admin access before any RPC", async () => {
  const { runAdminReservationStatus } = await import("../lib/reservations/admin-workflow.ts")
  let called = false
  const dependencies = {
    getAccess: async () => ({ kind: "forbidden" }),
    listReservations: async () => ({ data: null, errorCode: null }),
    readReservation: async () => ({ data: null, errorCode: null }),
    transitionReservation: async () => {
      called = true
      return { data: null, errorCode: null }
    },
  }
  const result = await runAdminReservationStatus(reservationId, "cancel", "운영 사유", dependencies)
  assert.deepEqual(result, {
    error: {
      code: "FORBIDDEN",
      message: "Active administrator access is required.",
      statusCode: 403,
    },
    status: "failure",
  })
  assert.equal(called, false)
})

test("admin reservation status delegates every approved mutation to the result RPC", async () => {
  const { createAdminReservationDependencies } = await import(
    "../lib/reservations/admin-operations.ts"
  )
  const calls = []
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: reservationId } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: { role: "admin", status: "active", deleted_at: null },
          error: null,
        }),
      }),
    }),
    rpc: async (name, args) => {
      calls.push({ args, name })
      return {
        data: [
          {
            idempotent: true,
            refund_id: null,
            refund_status: null,
            reservation_id: reservationId,
            reservation_status: "disputed",
          },
        ],
        error: null,
      }
    },
  }
  const dependencies = createAdminReservationDependencies(client)
  for (const action of [
    "complete",
    "mark_learner_no_show",
    "mark_coach_no_show",
    "open_dispute",
    "cancel",
  ]) {
    const result = await dependencies.transitionReservation(reservationId, action, "운영 사유")
    assert.equal(result.data?.idempotent, true)
  }
  assert.deepEqual(
    calls.map(({ name }) => name),
    Array(5).fill("transition_admin_reservation"),
  )
})

test("admin reservation workflow preserves authoritative replay and conflict mapping", async () => {
  const { runAdminReservationStatus } = await import("../lib/reservations/admin-workflow.ts")
  const base = {
    getAccess: async () => ({ kind: "admin" }),
    listReservations: async () => ({ data: null, errorCode: null }),
    readReservation: async () => ({ data: null, errorCode: null }),
    transitionReservation: async () => ({
      data: {
        idempotent: true,
        refundId: null,
        refundStatus: null,
        reservationId,
        status: "disputed",
      },
      errorCode: null,
    }),
  }
  const replay = await runAdminReservationStatus(reservationId, "open_dispute", "중복 처리", base)
  assert.equal(replay.response.data.idempotent, true)
  const conflict = await runAdminReservationStatus(reservationId, "open_dispute", "다른 사유", {
    ...base,
    transitionReservation: async () => ({ data: null, errorCode: "P0001" }),
  })
  assert.equal(conflict.error.code, "CONFLICT")
})

test("admin reservation stale and foreign RPC results map to conflict or not-found without retry writes", async () => {
  const { runAdminReservationStatus, runAdminReservationRead } = await import(
    "../lib/reservations/admin-workflow.ts"
  )
  const base = {
    getAccess: async () => ({ kind: "admin" }),
    listReservations: async () => ({ data: null, errorCode: null }),
    readReservation: async () => ({ data: null, errorCode: "P0002" }),
    transitionReservation: async () => ({ data: null, errorCode: "P0001" }),
  }
  const stale = await runAdminReservationStatus(reservationId, "open_dispute", "중복 처리", base)
  const foreign = await runAdminReservationRead(reservationId, base)
  assert.equal(stale.error?.code, "CONFLICT")
  assert.equal(foreign.error?.code, "NOT_FOUND")
})

test("admin report and reservation surfaces expose route-level loading, error, empty and success states", async () => {
  const files = await Promise.all([
    readFile("app/admin/reports/loading.tsx", "utf8"),
    readFile("app/admin/reports/error.tsx", "utf8"),
    readFile("app/admin/reports/page.tsx", "utf8"),
    readFile("app/admin/reservations/loading.tsx", "utf8"),
    readFile("app/admin/reservations/error.tsx", "utf8"),
    readFile("app/admin/reservations/page.tsx", "utf8"),
    readFile("components/admin/admin-reservation-actions.tsx", "utf8"),
  ])
  for (const file of [files[0], files[1], files[3], files[4]]) assert.match(file, /불러오/u)
  assert.match(files[2], /해당 상태의 신고가 없습니다/u)
  assert.match(files[5], /조건에 맞는 예약이 없습니다/u)
  assert.match(files[6], /상태가/u)
  assert.match(files[6], /다른 관리자가 먼저 상태를 변경했습니다/u)
})
