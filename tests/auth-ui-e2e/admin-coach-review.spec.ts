import { randomUUID } from "node:crypto"
import path from "node:path"

import { expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser } from "./auth-recovery-helpers"
import { expectVisibleFocus } from "./coach-apply-accessibility-helpers"

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test("admin approves a submitted coach and the applicant sees the atomic result", async ({
  page,
}, testInfo) => {
  const adminEmail = testEmail(testInfo, "admin-reviewer")
  const applicantEmail = testEmail(testInfo, "admin-review-applicant")
  const coachProfileId = randomUUID()
  const certificateId = randomUUID()
  let objectName: string | null = null

  try {
    const adminId = await createAuthUser(adminEmail)
    const applicantId = await createAuthUser(applicantEmail)
    objectName = `${applicantId}/${randomUUID()}.png`
    await createSubmittedApplication({
      adminId,
      applicantId,
      certificateId,
      coachProfileId,
      objectName,
    })

    await login(page, adminEmail, "/admin/coaches")
    await expect(page.getByRole("heading", { level: 1, name: "지도자 인증 심사" })).toBeVisible()
    await expect(page.getByRole("link", { name: /관리자 심사 신청자/u })).toBeVisible()
    await assertResponsiveListLayout(page)
    await capture(page, testInfo.project.name, "list")

    await page.getByRole("link", { name: /관리자 심사 신청자/u }).click()
    await expect(page.getByRole("heading", { level: 1, name: /지도자 신청/u })).toBeVisible()
    await expect(page.getByText("생활스포츠지도사", { exact: true })).toBeVisible()
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(`/certificates/${certificateId}`),
    )
    const popupPromise = page.waitForEvent("popup", { timeout: 5_000 })
    await page.getByRole("button", { name: "자격증 보기" }).click()
    const certificateResponse = await responsePromise
    expect(certificateResponse.status()).toBe(200)
    expect(await certificateResponse.json()).toMatchObject({ data: { expiresIn: 300 } })
    const popup = await popupPromise
    await expect.poll(() => popup.url()).toContain("/storage/v1/object/sign/coach-certificates/")
    await popup.close()
    await capture(page, testInfo.project.name, "detail-submitted")

    const approveResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith(`/${coachProfileId}/approve`),
    )
    const approvedReloadPromise = page.waitForEvent("framenavigated")
    await page.getByRole("button", { name: "승인" }).click()
    const approveResponse = await approveResponsePromise
    expect(approveResponse.status()).toBe(200)
    await approvedReloadPromise
    await page.waitForLoadState("domcontentloaded")

    const persisted = await readReviewOutcome(coachProfileId, applicantId)
    expect(persisted).toEqual({
      auditCount: 1,
      coachStatus: "approved",
      notificationCount: 1,
      profileStatus: "coach_approved",
      publicCardCount: 1,
    })
    injectCoachCertificationFailure("after-review")

    await page.goto(`/admin/coaches/${coachProfileId}`, { waitUntil: "domcontentloaded" })
    await expect(page.getByText("승인", { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "심사 결정" })).toHaveCount(0)
    await capture(page, testInfo.project.name, "detail-approved")

    await page.getByRole("button", { name: "로그아웃" }).click()
    await login(page, applicantEmail, "/coach/apply/status")
    await expect(
      page.getByRole("heading", { level: 1, name: "지도자 인증 신청 상태" }),
    ).toBeVisible()
    await expect(page.getByText("승인 완료", { exact: true }).first()).toBeVisible()
  } finally {
    await cleanupApplication(coachProfileId, objectName)
    await cleanupLiveAuthUser(adminEmail)
    await cleanupLiveAuthUser(applicantEmail)
  }
})

test("admin empty queue is announced and keyboard reachable", async ({ page }, testInfo) => {
  const adminEmail = testEmail(testInfo, "admin-empty-queue")

  try {
    const adminId = await createAuthUser(adminEmail)
    await withDb(async (sql) => {
      await sql`
        insert into public.profiles (id, display_name, role, status)
        values (${adminId}, '관리자 테스트 계정', 'admin', 'active')
      `
    })
    await login(page, adminEmail, "/admin/coaches")
    const empty = page.getByText("해당 상태의 신청서가 없습니다", { exact: true })
    await expect(empty).toBeVisible()
    await expect(page.getByRole("region", { name: "지도자 인증 신청 목록" })).toBeVisible()
    const draftFilter = page
      .getByRole("navigation", { name: "지도자 인증 상태 필터" })
      .getByRole("link", { name: "작성 중" })
    await draftFilter.focus()
    await expect(draftFilter).toBeFocused()
    await draftFilter.press("Enter")
    await expect(page).toHaveURL(/status=draft/u)
    await capture(page, testInfo.project.name, "empty")
  } finally {
    await cleanupLiveAuthUser(adminEmail)
  }
})

test("admin forbidden review failure is announced with visible focus", async ({
  page,
}, testInfo) => {
  const adminEmail = testEmail(testInfo, "admin-review-forbidden")
  const applicantEmail = testEmail(testInfo, "admin-review-forbidden-applicant")
  const coachProfileId = randomUUID()
  const certificateId = randomUUID()
  let objectName: string | null = null

  try {
    const adminId = await createAuthUser(adminEmail)
    const applicantId = await createAuthUser(applicantEmail)
    objectName = `${applicantId}/${randomUUID()}.png`
    await createSubmittedApplication({
      adminId,
      applicantId,
      certificateId,
      coachProfileId,
      objectName,
    })
    await login(page, adminEmail, `/admin/coaches/${coachProfileId}`)
    await page.route(`**/api/admin/coach-profiles/${coachProfileId}/approve`, async (route) => {
      await route.fulfill({ contentType: "application/json", status: 403, body: "{}" })
    })
    await page.getByRole("button", { name: "승인" }).click()
    const alert = page.getByText("심사 결과를 저장하지 못했습니다.", { exact: true })
    await expect(alert).toHaveAttribute("role", "alert")
    await expect(alert).toHaveText("심사 결과를 저장하지 못했습니다.")
    await expect(alert).toBeFocused()
    await expectVisibleFocus(alert)
    await capture(page, testInfo.project.name, "detail-forbidden-403")
  } finally {
    await cleanupApplication(coachProfileId, objectName)
    await cleanupLiveAuthUser(adminEmail)
    await cleanupLiveAuthUser(applicantEmail)
  }
})

async function createAuthUser(email: string) {
  const service = serviceClient()
  const created = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    password: testPassword,
  })
  if (created.error || !created.data.user) throw created.error ?? new Error("Auth user missing")
  return created.data.user.id
}

class CoachCertificationInjectedFailure extends Error {
  readonly name = "CoachCertificationInjectedFailure"
}

function injectCoachCertificationFailure(point: "after-review") {
  if (process.env["SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE"] === point) {
    throw new CoachCertificationInjectedFailure(`Injected coach certification failure: ${point}`)
  }
}

async function createSubmittedApplication(
  input: Readonly<{
    adminId: string
    applicantId: string
    certificateId: string
    coachProfileId: string
    objectName: string
  }>,
) {
  const service = serviceClient()
  const upload = await service.storage
    .from("coach-certificates")
    .upload(input.objectName, new Blob([pngBytes], { type: "image/png" }), {
      contentType: "image/png",
      upsert: false,
    })
  if (upload.error) throw upload.error
  await withDb(async (sql) => {
    const sport =
      await sql`select id from public.sports where is_active order by created_at limit 1`
    const sportId = sport[0]?.["id"]
    if (typeof sportId !== "string") throw new Error("Active sport is required")
    await sql`
      insert into public.profiles (id, display_name, role, status)
      values (${input.adminId}, '관리자 심사 담당자', 'admin', 'active')
    `
    await sql`
      insert into public.profiles (
        id, display_name, real_name, phone, avatar_path, default_region, role, status
      ) values (
        ${input.applicantId}, '관리자 심사 신청자', '관리자 심사 신청자', '010-0000-0000',
        ${`profiles/${input.applicantId}/avatar.png`}, '서울 강남구', 'learner', 'pending_coach'
      )
    `
    await sql`
      insert into public.coach_profiles (
        id, user_id, status, primary_sport_id, service_region, headline, bio, career_years,
        bank_name, bank_account_last4, payout_holder_name, submitted_at
      ) values (
        ${input.coachProfileId}, ${input.applicantId}, 'submitted', ${sportId}, '서울 강남구',
        '입문 전문 지도자', '안전한 입문 수업을 진행합니다.', 4,
        'SPOLINK 은행', '1234', '관리자 심사 신청자', now()
      )
    `
    await sql`
      insert into public.coach_certificates (
        id, coach_profile_id, certificate_name, issuer, certificate_number, file_path
      ) values (
        ${input.certificateId}, ${input.coachProfileId}, '생활스포츠지도사',
        '공인 발급기관', 'CERT-REDACTED', ${input.objectName}
      )
    `
  })
}

async function login(page: import("@playwright/test").Page, email: string, next: string) {
  await page.goto(`/auth/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await page.getByRole("button", { name: "로그인" }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe("/lessons")
  await page.goto(next)
  await expect.poll(() => new URL(page.url()).pathname).toBe(next)
}

async function readReviewOutcome(coachProfileId: string, applicantId: string) {
  return withDb(async (sql) => {
    const [tuple] = await sql`
      select cp.status as coach_status, p.status as profile_status
      from public.coach_profiles cp join public.profiles p on p.id = cp.user_id
      where cp.id = ${coachProfileId}
    `
    const [counts] = await sql`
      select
        (select count(*)::int from public.audit_logs where target_id = ${coachProfileId}) as audit_count,
        (select count(*)::int from public.notifications
          where user_id = ${applicantId} and type = 'coach_certification.reviewed') as notification_count,
        (select count(*)::int from public.coach_profile_public_cards
          where id = ${coachProfileId}) as public_card_count
    `
    return {
      auditCount: counts?.["audit_count"],
      coachStatus: tuple?.["coach_status"],
      notificationCount: counts?.["notification_count"],
      profileStatus: tuple?.["profile_status"],
      publicCardCount: counts?.["public_card_count"],
    }
  })
}

async function cleanupApplication(coachProfileId: string, objectName: string | null) {
  if (objectName) await serviceClient().storage.from("coach-certificates").remove([objectName])
  await withDb(async (sql) => {
    await sql`delete from public.coach_profiles where id = ${coachProfileId}`
  })
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

async function capture(page: import("@playwright/test").Page, projectName: string, state: string) {
  const outputDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!outputDir) return
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, `admin-coaches-${state}-${projectName}.png`),
  })
}

async function assertResponsiveListLayout(page: import("@playwright/test").Page) {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(horizontalOverflow, "admin coach list horizontal overflow").toBeLessThanOrEqual(0)

  const statusLinks = await page
    .getByRole("navigation", { name: "지도자 인증 상태 필터" })
    .getByRole("link")
    .all()
  for (const statusLink of statusLinks) {
    const fitsViewport = await statusLink.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })
    expect(fitsViewport, "admin coach status filter fits viewport").toBe(true)
  }
}
