import { randomUUID } from "node:crypto"
import path from "node:path"

import { expect, type Page, type TestInfo } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { testEmail, testPassword } from "./auth-form-helpers"

export type TrustSafetyFixture = Readonly<{
  adminEmail: string
  adminId: string
  blockId: string
  coachEmail: string
  coachId: string
  coachProfileId: string
  confirmedReservationId: string
  foreignId: string
  learnerEmail: string
  learnerId: string
  lessonId: string
  scheduleId: string
  suspendedAdminEmail: string
  suspendedAdminId: string
}>

export async function createTrustSafetyFixture(testInfo: TestInfo): Promise<TrustSafetyFixture> {
  const runSuffix = randomUUID()
  const learnerEmail = testEmail(testInfo, `trust-learner-${runSuffix}`)
  const coachEmail = testEmail(testInfo, `trust-coach-${runSuffix}`)
  const adminEmail = testEmail(testInfo, `trust-admin-${runSuffix}`)
  const suspendedAdminEmail = testEmail(testInfo, `trust-suspended-admin-${runSuffix}`)
  const [learnerId, coachId, adminId, suspendedAdminId, foreignId] = await Promise.all([
    createAuthUser(learnerEmail),
    createAuthUser(coachEmail),
    createAuthUser(adminEmail),
    createAuthUser(suspendedAdminEmail),
    createAuthUser(testEmail(testInfo, `trust-foreign-${runSuffix}`)),
  ])
  const fixture = {
    adminEmail,
    adminId,
    blockId: randomUUID(),
    coachEmail,
    coachId,
    coachProfileId: randomUUID(),
    confirmedReservationId: randomUUID(),
    foreignId,
    learnerEmail,
    learnerId,
    lessonId: randomUUID(),
    scheduleId: randomUUID(),
    suspendedAdminEmail,
    suspendedAdminId,
  }

  await withDb(async (sql) => {
    const [sport] = await sql`select id from public.sports where is_active order by slug limit 1`
    const sportId = sport?.["id"]
    if (typeof sportId !== "string") throw new Error("Active sport fixture is required")
    await sql`
      insert into public.profiles (id, display_name, role, status) values
        (${learnerId}, '신뢰 안전 학습자', 'learner', 'active'),
        (${coachId}, '신뢰 안전 지도자', 'coach', 'coach_approved'),
        (${adminId}, '신뢰 안전 관리자', 'admin', 'active'),
        (${suspendedAdminId}, '정지 검증 관리자', 'admin', 'active'),
        (${foreignId}, '관계 없는 사용자', 'learner', 'active')
    `
    await sql`
      insert into public.coach_profiles (id, user_id, status, service_region)
      values (${fixture.coachProfileId}, ${coachId}, 'approved', '서울')
    `
    await sql`
      insert into public.lessons (
        id, coach_profile_id, sport_id, status, title, description, region,
        duration_minutes, price_amount, capacity
      ) values (
        ${fixture.lessonId}, ${fixture.coachProfileId}, ${sportId}, 'active',
        '신뢰 안전 검증 레슨', '관리자 신고 처리 검증용 레슨', '서울', 60, 10000, 3
      )
    `
    await sql`
      insert into public.lesson_schedules (
        id, lesson_id, starts_at, ends_at, capacity, reserved_count
      ) values (
        ${fixture.scheduleId}, ${fixture.lessonId}, now() + interval '2 days',
        now() + interval '2 days 1 hour', 3, 1
      )
    `
    await sql`
      insert into public.reservations (
        id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id,
        status, reserved_price_amount, confirmed_at
      ) values (
        ${fixture.confirmedReservationId}, ${fixture.lessonId}, ${fixture.scheduleId},
        ${learnerId}, ${fixture.coachProfileId}, 'confirmed', 10000, now()
      )
    `
    await sql`
      insert into public.payments (
        reservation_id, payer_id, status, provider, provider_order_id, amount, approved_at
      ) values (
        ${fixture.confirmedReservationId}, ${learnerId}, 'paid', 'toss',
        ${`e2e_${fixture.confirmedReservationId}`}, 10000, now()
      )
    `
  })
  return fixture
}

export async function login(page: Page, email: string, next: string) {
  await page.goto("/auth/login?next=/lessons")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await page.getByRole("button", { name: "로그인" }).click()
  await page.waitForURL((url) => url.pathname === "/lessons")
  if (next !== "/lessons") {
    await page.goto(next)
    await page.waitForURL((url) => url.pathname === next)
  }
}

export async function logout(page: Page) {
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/"),
    page.getByRole("button", { name: "로그아웃" }).click(),
  ])
}

export async function postJson(page: Page, pathName: string, body: object) {
  return page.evaluate(
    async ({ body: requestBody, path }) => {
      const response = await fetch(path, {
        body: JSON.stringify(requestBody),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      return { body: await response.json(), status: response.status }
    },
    { body, path: pathName },
  )
}

export async function readTrustOutcome(fixture: TrustSafetyFixture, reportId: string) {
  return withDb(async (sql) => {
    const [row] = await sql`
      select
        (select status::text from public.reservations where id = ${fixture.confirmedReservationId})
          as reservation_status,
        (select status::text from public.lessons where id = ${fixture.lessonId}) as lesson_status,
        (select count(*)::int from public.audit_logs
          where target_type = 'report' and target_id = ${reportId}) as audit_count,
        (select count(*)::int from public.notifications
          where type = 'report.resolved' and data ->> 'reportId' = ${reportId})
          as notification_count
    `
    return row
  })
}

export async function readReservationAdminOutcome(fixture: TrustSafetyFixture) {
  return withDb(async (sql) => {
    const [row] = await sql`
      select
        (select status::text from public.reservations where id = ${fixture.confirmedReservationId})
          as reservation_status,
        (select count(*)::int from public.audit_logs
          where action = 'reservation.disputed'
            and target_type = 'reservation'
            and target_id = ${fixture.confirmedReservationId}) as audit_count,
        (select count(*)::int from public.notifications
          where data ->> 'reservationId' = ${fixture.confirmedReservationId}
            and type = 'reservation_cancelled') as notification_count
    `
    return row
  })
}

export async function authenticatedServiceClient(email: string) {
  const client = createClient(
    process.env["SPOLINK_AUTH_E2E_API_URL"] ?? "",
    process.env["SPOLINK_AUTH_E2E_ANON_KEY"] ?? "",
    {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    },
  )
  const result = await client.auth.signInWithPassword({ email, password: testPassword })
  if (result.error) throw result.error
  return client
}

export async function suspendFixtureAdmin(fixture: TrustSafetyFixture) {
  await withDb(async (sql) => {
    await sql`update public.profiles set status = 'suspended' where id = ${fixture.suspendedAdminId}`
  })
}

export async function cleanupTrustSafetyFixture(fixture: TrustSafetyFixture | null) {
  if (!fixture) return
  await withDb(async (sql) => {
    await sql`delete from public.audit_logs where actor_id in (
      ${fixture.coachId}, ${fixture.adminId}, ${fixture.suspendedAdminId}
    )`
    await sql`delete from public.notifications where user_id = ${fixture.learnerId}`
    await sql`delete from public.reports where reporter_id = ${fixture.learnerId}`
    await sql`delete from public.blocks where blocker_id = ${fixture.learnerId}`
    await sql`delete from public.settlements where reservation_id = ${fixture.confirmedReservationId}`
    await sql`delete from public.payments where reservation_id = ${fixture.confirmedReservationId}`
    await sql`delete from public.reservations where id = ${fixture.confirmedReservationId}`
    await sql`delete from public.lesson_schedules where id = ${fixture.scheduleId}`
    await sql`delete from public.lessons where id = ${fixture.lessonId}`
    await sql`delete from public.coach_profiles where id = ${fixture.coachProfileId}`
    await sql`delete from public.profiles where id in (
      ${fixture.learnerId}, ${fixture.coachId}, ${fixture.adminId},
      ${fixture.suspendedAdminId}, ${fixture.foreignId}
    )`
  })
  const service = serviceClient()
  await Promise.all(
    [
      fixture.learnerId,
      fixture.coachId,
      fixture.adminId,
      fixture.suspendedAdminId,
      fixture.foreignId,
    ].map((userId) => service.auth.admin.deleteUser(userId)),
  )
}

export async function captureTrustSafety(
  page: Page,
  projectName: string,
  state: string,
  redactedText: readonly string[] = [],
) {
  const outputDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!outputDir) return
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({
    fullPage: true,
    mask: redactedText.map((value) => page.getByText(value, { exact: true })),
    maskColor: "#ffffff",
    path: path.join(outputDir, `admin-reports-${state}-${projectName}.png`),
  })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, "admin report page horizontal overflow").toBeLessThanOrEqual(0)
}

async function createAuthUser(email: string) {
  const result = await serviceClient().auth.admin.createUser({
    email,
    email_confirm: true,
    password: testPassword,
  })
  if (result.error || !result.data.user) throw result.error ?? new Error("Auth user missing")
  return result.data.user.id
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
