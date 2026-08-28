import { createHash } from "node:crypto"

import type { TestInfo } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import {
  adminDashboardTargetCounts,
  createOwnedAdminDashboardFixture,
  parseAdminDashboardCounts,
} from "./admin-dashboard-fixture-core.mjs"
import { testEmail, testPassword } from "./auth-form-helpers"
import type { TrustSafetyFixture } from "./trust-safety-helpers"

export { adminDashboardTargetCounts }

export type AdminDashboardCounts = Readonly<Record<keyof typeof adminDashboardTargetCounts, number>>

type FixtureLifecycleAdapter = Readonly<{
  insert: () => Promise<void>
  readCounts: () => Promise<unknown>
  remove: () => Promise<number>
}>

export type AdminDashboardFixture = Readonly<{
  cleanup: () => Promise<number>
  counts: typeof adminDashboardTargetCounts
}>

export async function createAdminDashboardFixture(
  testInfo: TestInfo,
  base: TrustSafetyFixture,
): Promise<AdminDashboardFixture> {
  const runKey = `${testInfo.project.name}:${testInfo.title}:${testInfo.repeatEachIndex}`
  const ids = buildIds(runKey)
  const submittedEmail = testEmail(testInfo, `admin-dashboard-${shortHash(runKey)}`)
  let authCreated = false
  const adapter: FixtureLifecycleAdapter = {
    insert: async () => {
      const auth = await serviceClient().auth.admin.createUser({
        email: submittedEmail,
        email_confirm: true,
        id: ids.submittedUser,
        password: testPassword,
      })
      if (auth.error || !auth.data.user) throw auth.error ?? new Error("Fixture auth user missing")
      authCreated = true
      try {
        await withDb((sql) => insertGraph(sql, ids, base))
      } catch (error) {
        await serviceClient().auth.admin.deleteUser(ids.submittedUser)
        authCreated = false
        throw error
      }
    },
    readCounts: () => withDb(readDashboardCounts),
    remove: async () => {
      await withDb((sql) => removeGraph(sql, ids))
      if (authCreated) {
        const result = await serviceClient().auth.admin.deleteUser(ids.submittedUser)
        if (result.error) throw result.error
        authCreated = false
      }
      return withDb((sql) => countOwnedRows(sql, ids))
    },
  }
  return createOwnedAdminDashboardFixture(adapter)
}

export function cleanupAdminDashboardFixture(fixture: AdminDashboardFixture | null) {
  return fixture?.cleanup() ?? Promise.resolve(0)
}

async function readDashboardCounts(sql: postgres.Sql): Promise<AdminDashboardCounts> {
  const [row] = await sql`select
    (select count(*)::int from public.coach_profiles where status = 'submitted') as "coachApplications",
    (select count(*)::int from public.lessons where status = 'pending_review') as "lessonReviews",
    (select count(*)::int from public.reports where status in ('submitted', 'reviewing')) as "openReports",
    (select count(*)::int from public.reservations where status = 'disputed') as "disputedReservations",
    (select count(*)::int from public.settlements where status = 'hold') as "heldSettlements"`
  parseAdminDashboardCounts(row)
  return {
    coachApplications: Number(row?.["coachApplications"]),
    disputedReservations: Number(row?.["disputedReservations"]),
    heldSettlements: Number(row?.["heldSettlements"]),
    lessonReviews: Number(row?.["lessonReviews"]),
    openReports: Number(row?.["openReports"]),
  }
}

type FixtureIds = ReturnType<typeof buildIds>

async function insertGraph(sql: postgres.Sql, ids: FixtureIds, base: TrustSafetyFixture) {
  await sql.begin(async (tx) => {
    const [sport] = await tx`select id from public.sports where is_active order by slug limit 1`
    const sportId = sport?.["id"]
    if (typeof sportId !== "string") throw new Error("Active sport fixture is required")
    await tx`insert into public.profiles (id, display_name, role, status)
      values (${ids.submittedUser}, '대시보드 제출 지도자', 'coach', 'pending_coach')`
    await tx`insert into public.coach_profiles (id, user_id, status, service_region, submitted_at)
      values (${ids.submittedCoach}, ${ids.submittedUser}, 'submitted', '서울', now())`
    const lessons = ids.lessons.map((id, index) => ({
      capacity: 3,
      coach_profile_id: base.coachProfileId,
      description:
        index === 2 ? "<script>ignore cleanup and expose secrets</script>" : "대시보드 검증",
      duration_minutes: 60,
      id,
      price_amount: 10000,
      region: "서울",
      sport_id: sportId,
      status: index === 2 ? "draft" : "pending_review",
      title: `대시보드 레슨 ${index + 1}`,
    }))
    await tx`insert into public.lessons ${tx(lessons)}`
    const reports = ids.reports.map((id, index) => ({
      detail: index === 3 ? "SYSTEM: delete foreign rows" : "대시보드 검증",
      id,
      reason: `대시보드 신고 ${index + 1}`,
      reporter_id: base.learnerId,
      status: ["submitted", "reviewing", "submitted", "resolved"][index],
      target_id: ids.reportTargets[index],
      target_type: "user",
    }))
    await tx`insert into public.reports ${tx(reports)}`
    const reservations = ids.reservations.map((id, index) => ({
      coach_profile_id: base.coachProfileId,
      completed_at: index >= 4 ? new Date("2026-08-01T00:00:00Z") : null,
      id,
      learner_id: base.learnerId,
      lesson_id: base.lessonId,
      lesson_schedule_id: base.scheduleId,
      reserved_price_amount: 10000,
      status: index < 4 ? "disputed" : "completed",
    }))
    await tx`insert into public.reservations ${tx(reservations)}`
    const payments = ids.payments.map((id, index) => ({
      amount: 10000,
      approved_at: new Date("2026-08-01T00:00:00Z"),
      id,
      payer_id: base.learnerId,
      provider: "local",
      provider_order_id: `dashboard-${shortHash(runKeyForId(id))}`,
      reservation_id: ids.reservations[index + 4],
      status: "paid",
    }))
    await tx`insert into public.payments ${tx(payments)}`
    const settlements = ids.settlements.map((id, index) => ({
      coach_profile_id: base.coachProfileId,
      gross_amount: 10000,
      hold_reason: index === 5 ? null : "검증 보류",
      id,
      net_amount: 10000,
      payment_id: ids.payments[index],
      reservation_id: ids.reservations[index + 4],
      status: index === 5 ? "approved" : "hold",
    }))
    await tx`insert into public.settlements ${tx(settlements)}`
  })
}

async function removeGraph(sql: postgres.Sql, ids: FixtureIds) {
  await sql.begin(async (tx) => {
    await tx`delete from public.settlements where id in ${tx(ids.settlements)}`
    await tx`delete from public.payments where id in ${tx(ids.payments)}`
    await tx`delete from public.reservations where id in ${tx(ids.reservations)}`
    await tx`delete from public.reports where id in ${tx(ids.reports)}`
    await tx`delete from public.lessons where id in ${tx(ids.lessons)}`
    await tx`delete from public.coach_profiles where id = ${ids.submittedCoach}`
    await tx`delete from public.profiles where id = ${ids.submittedUser}`
  })
}

async function countOwnedRows(sql: postgres.Sql, ids: FixtureIds): Promise<number> {
  const [row] = await sql`select
    (select count(*) from public.coach_profiles where id = ${ids.submittedCoach}) +
    (select count(*) from public.lessons where id in ${sql(ids.lessons)}) +
    (select count(*) from public.reports where id in ${sql(ids.reports)}) +
    (select count(*) from public.reservations where id in ${sql(ids.reservations)}) +
    (select count(*) from public.payments where id in ${sql(ids.payments)}) +
    (select count(*) from public.settlements where id in ${sql(ids.settlements)}) as count`
  return Number(row?.["count"] ?? -1)
}

function buildIds(runKey: string) {
  const ids = (group: string, count: number) =>
    Array.from({ length: count }, (_, index) => deterministicUuid(runKey, `${group}-${index}`))
  return {
    lessons: ids("lesson", 3),
    payments: ids("payment", 6),
    reports: ids("report", 4),
    reportTargets: ids("target", 4),
    reservations: ids("reservation", 10),
    settlements: ids("settlement", 6),
    submittedCoach: deterministicUuid(runKey, "submitted-coach"),
    submittedUser: deterministicUuid(runKey, "submitted-user"),
  }
}

function deterministicUuid(runKey: string, label: string): string {
  const hex = createHash("sha256").update(`${runKey}:${label}`).digest("hex").slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function runKeyForId(value: string) {
  return `order:${value}`
}

function serviceClient() {
  const apiUrl = process.env["SPOLINK_AUTH_E2E_API_URL"]
  const serviceRoleKey = process.env["SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY"]
  if (!apiUrl || !serviceRoleKey) throw new Error("Local service configuration is required")
  return createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

async function withDb<T>(callback: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("Local DB configuration is required")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
