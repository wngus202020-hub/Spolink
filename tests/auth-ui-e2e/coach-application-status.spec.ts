import { randomUUID } from "node:crypto"
import path from "node:path"

import { expect, test } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import { expectVisibleFocus } from "./coach-apply-accessibility-helpers"

const states = ["draft", "submitted", "approved", "rejected", "suspended"] as const

test("valid applicant submits through real HTTP and reads the private submitted status", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "coach-submit-http")
  const coachProfileId = randomUUID()
  const objectName = `${randomUUID()}/${randomUUID()}.png`

  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const ownedObjectName = `${session.userId}/${objectName.split("/")[1]}`
    await createApplication(session.userId, coachProfileId, "draft", ownedObjectName, true)

    const results = await page.evaluate(async () => {
      const requests = [1, 2].map(async () => {
        const response = await fetch("/api/coach-profile/me/submit", {
          body: "{}",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
        return {
          body: await response.json(),
          cacheControl: response.headers.get("cache-control"),
          status: response.status,
        }
      })
      return Promise.all(requests)
    })

    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(results.every((result) => result.cacheControl === "private, no-store")).toBe(true)
    const success = results.find((result) => result.status === 200)
    expect(success?.body.data).toMatchObject({
      coachStatus: "submitted",
      profileRole: "learner",
      profileStatus: "pending_coach",
    })
    injectCoachCertificationFailure("after-submit")

    await page.goto("/coach/apply/status")
    await expect(
      page.getByRole("heading", { level: 1, name: "지도자 인증 신청 상태" }),
    ).toBeVisible()
    await expect(page.getByText("심사 중", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("신청 정보는 본인 계정에서만 확인할 수 있어요.")).toBeVisible()
    await captureStatus(page, testInfo.project.name, "submitted-http")
  } finally {
    await cleanupApplication(coachProfileId)
    await cleanupLiveAuthUser(email)
  }
})

test("status loading boundary is announced before submitted content", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "coach-status-loading")
  const coachProfileId = randomUUID()

  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await createApplication(session.userId, coachProfileId, "submitted", null, false)

    await page.goto("/coach/apply/status?uiFixture=loading")
    const loading = page.getByText("신청 상태를 불러오고 있어요.")
    await expect(loading).toBeVisible()
    await expect(loading).toHaveAttribute("aria-live", "polite")
    await expect(page.getByText("심사 중", { exact: true })).toBeHidden()
    const loadingArtifact = await captureStatus(page, testInfo.project.name, "loading")
    await page.goto("/coach/apply/status")
    await expect(page.getByRole("heading", { name: "지도자 인증 신청 상태" })).toBeVisible()
    const submittedArtifact = await page.screenshot({ fullPage: true })
    expect(
      loadingArtifact?.equals(submittedArtifact),
      "loading artifact differs from submitted content",
    ).toBe(false)
  } finally {
    await cleanupApplication(coachProfileId)
    await cleanupLiveAuthUser(email)
  }
})

test("status error boundary focuses its heading and retry is keyboard operable", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "coach-status-error")
  const coachProfileId = randomUUID()

  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await createApplication(session.userId, coachProfileId, "submitted", null, false)
    await page.goto("/coach/apply/status")
    await page.getByTestId("coach-status-error-fixture").dispatchEvent("click")

    const heading = page.getByRole("heading", { name: "신청 상태를 불러오지 못했어요." })
    await expect(heading).toBeVisible()
    await expect(heading).toBeFocused()
    await expectVisibleFocus(heading)
    await captureStatus(page, testInfo.project.name, "error")
    const retry = page.getByRole("button", { name: "다시 시도" })
    await retry.focus()
    await expect(retry).toBeFocused()
    await captureStatus(page, testInfo.project.name, "error-retry")
    await retry.press("Enter")
    await expect(heading).toBeVisible()
  } finally {
    await cleanupApplication(coachProfileId)
    await cleanupLiveAuthUser(email)
  }
})

for (const state of states) {
  test(`${state} applicant sees its exact private status and next action`, async ({
    page,
  }, testInfo) => {
    const email = testEmail(testInfo, `coach-status-${state}`)
    const coachProfileId = randomUUID()

    try {
      const session = await createLiveAuthSession(page, email, testPassword)
      await createApplication(session.userId, coachProfileId, state, null, false)

      const response = await page.goto("/coach/apply/status")
      expect(response?.headers()["cache-control"]).toMatch(
        /^(?:private, no-store|no-cache, must-revalidate)$/u,
      )
      await expect(
        page.getByRole("heading", { level: 1, name: "지도자 인증 신청 상태" }),
      ).toBeVisible()
      await expect(page.getByText(expectedLabel(state), { exact: true }).first()).toBeVisible()
      await expect(page.getByRole("link", { name: expectedAction(state) })).toBeVisible()
      if (state === "submitted") await assertSubmittedHeaderSeparation(page)
      if (state === "rejected") {
        await expect(page.getByText("반려 사유", { exact: true })).toBeVisible()
        await expect(page.getByText("자격 증빙을 다시 확인해 주세요.")).toBeVisible()
      }
      await captureStatus(page, testInfo.project.name, state)
    } finally {
      await cleanupApplication(coachProfileId)
      await cleanupLiveAuthUser(email)
    }
  })
}

async function assertSubmittedHeaderSeparation(page: import("@playwright/test").Page) {
  const heading = page.getByRole("heading", { level: 2, name: "심사 중" })
  const icon = heading.locator("xpath=../preceding-sibling::*[1]")
  const [headingBox, iconBox] = await Promise.all([heading.boundingBox(), icon.boundingBox()])
  expect(headingBox, "submitted heading bounds").not.toBeNull()
  expect(iconBox, "submitted icon bounds").not.toBeNull()
  if (!headingBox || !iconBox) throw new Error("Submitted header bounds are required")
  expect(headingBox.x - (iconBox.x + iconBox.width), "submitted header gap").toBeGreaterThanOrEqual(
    20,
  )
}

class CoachCertificationInjectedFailure extends Error {
  readonly name = "CoachCertificationInjectedFailure"
}

function injectCoachCertificationFailure(point: "after-submit") {
  if (process.env["SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE"] === point) {
    throw new CoachCertificationInjectedFailure(`Injected coach certification failure: ${point}`)
  }
}

async function createApplication(
  userId: string,
  coachProfileId: string,
  state: (typeof states)[number],
  objectName: string | null,
  complete: boolean,
) {
  await withDb(async (sql) => {
    const profileStatus =
      state === "submitted"
        ? "pending_coach"
        : state === "approved"
          ? "coach_approved"
          : state === "suspended"
            ? "suspended"
            : "active"
    const sport =
      await sql`select id from public.sports where is_active order by created_at limit 1`
    const sportId = sport[0]?.["id"]
    if (!sportId) throw new Error("Active sport fixture is required")

    await sql`
      insert into public.profiles (
        id, display_name, real_name, phone, avatar_path, default_region, role, status
      ) values (
        ${userId}, '상태 확인 신청자', '상태 확인 신청자', '010-0000-0000',
        ${`profiles/${userId}/avatar.png`}, '서울 강남구', 'learner', ${profileStatus}
      )
    `
    await sql`
      insert into public.coach_profiles (
        id, user_id, status, primary_sport_id, service_region, headline, bio, career_years,
        bank_name, bank_account_last4, payout_holder_name, submitted_at, reviewed_at,
        rejection_reason
      ) values (
        ${coachProfileId}, ${userId}, ${state}, ${sportId}, '서울 강남구', '입문 전문 지도자',
        '안전한 입문 수업을 진행합니다.', 4, 'SPOLINK 은행', '1234', '상태 확인 신청자',
        ${state === "draft" ? null : new Date()},
        ${state === "approved" || state === "rejected" || state === "suspended" ? new Date() : null},
        ${state === "rejected" ? "자격 증빙을 다시 확인해 주세요." : null}
      )
    `
    if (complete && objectName) {
      await sql`
        insert into storage.objects (bucket_id, name, owner_id, metadata)
        values ('coach-certificates', ${objectName}, ${userId}, '{"mimetype":"image/png","size":8}'::jsonb)
      `
      await sql`
        insert into public.coach_certificates (coach_profile_id, certificate_name, file_path)
        values (${coachProfileId}, '생활스포츠지도사', ${objectName})
      `
    }
  })
}

async function cleanupApplication(coachProfileId: string) {
  const objectNames = await withDb(
    async (sql) =>
      sql`select file_path from public.coach_certificates where coach_profile_id = ${coachProfileId}`,
  )
  const apiUrl = process.env["SPOLINK_AUTH_E2E_API_URL"]
  const serviceRoleKey = process.env["SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY"]
  if (!apiUrl || !serviceRoleKey) throw new Error("Local service cleanup configuration is required")
  const names = objectNames.flatMap((row) =>
    typeof row["file_path"] === "string" ? [row["file_path"]] : [],
  )
  if (names.length > 0) {
    const serviceClient = createClient(apiUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await serviceClient.storage.from("coach-certificates").remove(names)
    if (error) throw error
  }
  await withDb(async (sql) => {
    await sql`delete from public.coach_profiles where id = ${coachProfileId}`
  })
}

async function withDb<T>(callback: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}

function expectedLabel(state: (typeof states)[number]) {
  return {
    approved: "승인 완료",
    draft: "작성 중",
    rejected: "보완 필요",
    submitted: "심사 중",
    suspended: "이용 제한",
  }[state]
}

function expectedAction(state: (typeof states)[number]) {
  return {
    approved: "마이페이지로 이동",
    draft: "신청서 계속 작성",
    rejected: "신청서 보완",
    submitted: "레슨 둘러보기",
    suspended: "이용 제한 안내",
  }[state]
}

async function captureStatus(
  page: import("@playwright/test").Page,
  projectName: string,
  state: string,
) {
  const outputDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  return page.screenshot({
    fullPage: true,
    ...(outputDir
      ? { path: path.join(outputDir, `coach-application-status-${state}-${projectName}.png`) }
      : {}),
  })
}
