import { randomUUID } from "node:crypto"
import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

test("anonymous coach application preserves safe login return", async ({ page }) => {
  await page.goto("/coach/apply")

  const redirectedUrl = new URL(page.url())
  expect(redirectedUrl.pathname).toBe("/auth/login")
  expect(redirectedUrl.searchParams.get("next")).toBe("/coach/apply")
  await expect(page.getByRole("heading", { name: "다시 운동을 시작할 시간이에요." })).toBeVisible()
  await expect(page.getByRole("heading", { name: "지도자 인증 신청" })).toHaveCount(0)
})

test("profile-required users are sent to profile setup", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "coach-apply-profile-required")

  try {
    await createLiveAuthSession(page, email, testPassword)

    await page.goto("/lessons")
    await expect(page.getByRole("link", { exact: true, name: "프로필 설정" })).toBeVisible()
    await expect(page.getByRole("link", { exact: true, name: "마이" })).toHaveCount(0)

    await page.goto("/coach/apply")
    await expect(page).toHaveURL(/\/onboarding\/profile$/u)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("ready profile saves a draft and manages private certificate metadata", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "coach-apply-ready")
  const runtimeErrors: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const sportId = await createReadyProfile(session.userId)

    await page.goto("/coach/apply")

    await expect(page).toHaveURL(/\/coach\/apply$/u)
    await expect(page.getByRole("heading", { level: 1, name: "지도자 인증 신청" })).toBeVisible()
    for (const heading of ["계정 정보 요약", "신청 정보", "자격증", "정산 정보"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible()
    }
    await expect(page.getByText("홍지원")).toBeVisible()
    await expect(page.getByText("010-9000-0000")).toBeVisible()
    await page.getByLabel("한 줄 소개").fill("테니스 입문 전문 지도자")
    await page.getByLabel("대표 종목").selectOption(sportId)
    await page.getByLabel("활동 지역").fill("서울 강남구")
    await page.getByLabel("경력 연수").fill("5")
    await page.getByLabel("소개글").fill("초보자도 안전하게 배울 수 있도록 지도합니다.")
    await page.getByLabel("은행명").fill("SPOLINK 은행")
    await page.getByLabel("계좌 끝 4자리").fill("1234")
    await page.getByLabel("예금주").fill("홍지원")
    await page.getByRole("button", { name: "임시 저장" }).click()
    await expect(page.getByText("임시 저장했어요.")).toBeVisible()
    await captureCoachApplyScreenshot(page, testInfo.project.name, "draft")
    await page.reload()
    await expect(page.getByLabel("한 줄 소개")).toHaveValue("테니스 입문 전문 지도자")
    await page.getByLabel("자격증명").fill("생활스포츠지도사")
    await page.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: "image/png",
      name: "certificate.png",
    })
    await expect(page.getByText("생활스포츠지도사", { exact: true })).toBeVisible()
    injectCoachCertificationFailure("after-upload")
    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "생활스포츠지도사 삭제" }).click()
    await expect(page.getByText("자격증을 삭제했어요.")).toBeVisible()
    await expect(page.getByText("등록된 자격증이 없어요.")).toBeVisible()

    expect(runtimeErrors).toEqual([])
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("draft applicant receives an actionable conflict message when submission is stale", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "coach-apply-submit-conflict")
  const applicationId = randomUUID()

  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const sportId = await createReadyProfile(session.userId)
    await page.route("**/api/coach-profile/me", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              bankAccountLast4: "1234",
              bankName: "SPOLINK 은행",
              bio: "안전한 입문 수업을 진행합니다.",
              careerYears: 4,
              certificates: [],
              headline: "입문 전문 지도자",
              id: applicationId,
              payoutHolderName: "홍지원",
              primarySportId: sportId,
              rejectionReason: null,
              serviceRegion: "서울 강남구",
              status: "draft",
            },
          }),
        })
        return
      }
      await route.fallback()
    })
    await page.route("**/api/coach-profile/me/submit", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        status: 409,
        body: JSON.stringify({ error: { code: "COACH_APPLICATION_CONFLICT" } }),
      })
    })

    await page.goto("/coach/apply")
    await expect(page.getByText("작성 중", { exact: true })).toBeVisible()
    const submissionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/coach-profile/me/submit") &&
        response.request().method() === "POST",
    )
    await page.getByRole("button", { name: "심사 제출" }).click()
    expect((await submissionResponse).status()).toBe(409)

    const alert = page.locator("form").getByRole("alert")
    await expect(alert).toHaveText("심사 상태가 바뀌었어요. 신청 상태를 확인해요.")
    await expect(alert).toBeFocused()
    await captureCoachApplyScreenshot(page, testInfo.project.name, "conflict")
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

async function createReadyProfile(userId: string): Promise<string> {
  return await withDb(async (sql) => {
    await sql`
      insert into public.profiles (id, display_name, real_name, phone, default_region)
      values (${userId}, '지도자 신청자', '홍지원', '010-9000-0000', '서울 강남구')
    `
    const sports = await sql<{ id: string }[]>`
      select id from public.sports where is_active = true order by name limit 1
    `
    const sport = sports[0]
    if (!sport) throw new CoachApplyFixtureError()
    return sport.id
  })
}

class CoachApplyFixtureError extends Error {
  readonly name = "CoachApplyFixtureError"

  constructor() {
    super("Active sport fixture is required.")
  }
}

class CoachCertificationInjectedFailure extends Error {
  readonly name = "CoachCertificationInjectedFailure"
}

function injectCoachCertificationFailure(point: "after-upload") {
  if (process.env["SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE"] === point) {
    throw new CoachCertificationInjectedFailure(`Injected coach certification failure: ${point}`)
  }
}

async function captureCoachApplyScreenshot(
  page: import("@playwright/test").Page,
  projectName: string,
  state: string,
) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    mask: [
      page.getByText("홍지원", { exact: true }),
      page.getByText("010-9000-0000", { exact: true }),
      page.getByLabel("은행명"),
      page.getByLabel("계좌 끝 4자리"),
      page.getByLabel("예금주"),
    ],
    path: path.join(visualQaDir, `coach-apply-${state}-${projectName}.png`),
  })
}

async function withDb<T>(callback: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
