import { randomUUID } from "node:crypto"
import path from "node:path"

import { expect, type Page, type TestInfo, test } from "@playwright/test"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import { expectTextContrast, expectVisibleFocus } from "./coach-apply-accessibility-helpers"

const applicationId = randomUUID()

const failureCases = [
  { copy: "로그인이 만료되었어요. 다시 로그인해요.", name: "unauthorized-401", status: 401 },
  {
    copy: "이 작업을 진행할 권한이 없어요. 이용 상태를 확인해요.",
    name: "forbidden-403",
    status: 403,
  },
  {
    copy: "필수 신청 정보와 자격증을 다시 확인해요.",
    name: "validation-422",
    status: 422,
  },
] as const

test("application loading state is announced before the form becomes ready", async ({
  page,
}, testInfo) => {
  await withReadyApplicant(page, testInfo, async () => {
    let releaseRead = () => {}
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    await page.route("**/api/coach-profile/me", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      await readGate
      await route.fulfill({ contentType: "application/json", body: '{"data":null}' })
    })

    await page.goto("/coach/apply")
    const loading = page.getByText("신청서를 불러오고 있어요.")
    await expect(loading).toBeVisible()
    await expect(loading).toHaveAttribute("aria-live", "polite")
    await capture(page, testInfo.project.name, "loading")
    releaseRead()
    await expect(page.getByRole("button", { name: "임시 저장" })).toBeVisible()
  })
})

test("application read failure is shown as a focused alert", async ({ page }, testInfo) => {
  await withReadyApplicant(page, testInfo, async () => {
    await page.route("**/api/coach-profile/me", async (route) => {
      await route.fulfill({ contentType: "application/json", status: 500, body: "{}" })
    })
    await page.goto("/coach/apply")
    const alert = page.locator("form").getByRole("alert")
    await expect(alert).toHaveText("요청을 완료하지 못했어요. 잠시 후 다시 시도해요.")
    await expect(alert).toBeFocused()
    await expectVisibleFocus(alert)
    await capture(page, testInfo.project.name, "error")
  })
})

for (const failureCase of failureCases) {
  test(`application save renders actionable ${failureCase.status} feedback`, async ({
    page,
  }, testInfo) => {
    await withReadyApplicant(page, testInfo, async () => {
      await mockEmptyApplication(page)
      await page.route("**/api/coach-profile/me", async (route) => {
        if (route.request().method() === "GET") return route.fallback()
        await route.fulfill({
          contentType: "application/json",
          status: failureCase.status,
          body: JSON.stringify({ error: { code: "TEST_BOUNDARY" } }),
        })
      })
      await page.goto("/coach/apply")
      const submit = page.getByRole("button", { name: "심사 제출" })
      await expect(submit).toBeDisabled()
      await expect(submit).toHaveAttribute("aria-describedby", "submit-prerequisite")
      await page.getByRole("button", { name: "임시 저장" }).click()
      const alert = page.locator("form").getByRole("alert")
      await expect(alert).toHaveText(failureCase.copy)
      await expect(alert).toBeFocused()
      await expectVisibleFocus(alert)
      await expectTextContrast(alert, 4.5, `${failureCase.status} alert`)
      await capture(page, testInfo.project.name, failureCase.name)
    })
  })
}

test("certificate upload failure keeps the form usable and explains recovery", async ({
  page,
}, testInfo) => {
  await withReadyApplicant(page, testInfo, async (sportId) => {
    await page.route("**/api/coach-profile/me", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: draftApplication(sportId) }),
      })
    })
    await page.route("**/api/coach-profile/me/certificate-upload-url", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            expiresIn: 300,
            objectName: "redacted/certificate.png",
            uploadUrl: "/__coach-upload-fixture",
          },
        }),
      })
    })
    await page.route("**/__coach-upload-fixture", async (route) => {
      await route.fulfill({ status: 503, body: "upload unavailable" })
    })
    await page.goto("/coach/apply")
    await page.getByLabel("자격증명").fill("생활스포츠지도사")
    await page.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: "image/png",
      name: "certificate.png",
    })
    const alert = page.locator("form").getByRole("alert")
    await expect(alert).toHaveText("파일 업로드에 실패했어요. 다시 시도해요.")
    await expect(alert).toBeFocused()
    await expectVisibleFocus(alert)
    await expect(page.getByLabel("자격증명")).toBeEnabled()
    await capture(page, testInfo.project.name, "upload-failure")
  })
})

test("keyboard order, visible focus, labels, roles, and text contrast remain accessible", async ({
  page,
}, testInfo) => {
  await withReadyApplicant(page, testInfo, async (sportId) => {
    await page.route("**/api/coach-profile/me", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: draftApplication(sportId) }),
      })
    })
    await page.goto("/coach/apply")
    const focusPath = [
      page.getByLabel("한 줄 소개"),
      page.getByLabel("대표 종목"),
      page.getByLabel("활동 지역"),
      page.getByLabel("경력 연수"),
      page.getByLabel("소개글"),
      page.getByLabel("은행명"),
      page.getByLabel("계좌 끝 4자리"),
      page.getByLabel("예금주"),
      page.getByLabel("자격증명"),
      page.getByLabel("발급 기관"),
      page.getByLabel("자격 번호"),
      page.getByLabel("자격증 업로드"),
      page.getByRole("button", { name: "임시 저장" }),
      page.getByRole("button", { name: "심사 제출" }),
    ]
    for (const control of focusPath) await expect(control).toBeEnabled()
    await focusPath[0]?.focus()
    for (const control of focusPath) {
      await expect(control).toBeFocused()
      const indicator =
        (await control.getAttribute("type")) === "file" ? control.locator("..") : control
      await expectVisibleFocus(indicator)
      await page.keyboard.press("Tab")
    }
    await expectTextContrast(page.getByText("지도자 인증 신청", { exact: true }), 4.5, "heading")
    await expectTextContrast(
      page.getByText("지도자 소개와 실제 활동 범위를 입력해요.", { exact: true }),
      4.5,
      "secondary guidance",
    )
    await expectTextContrast(page.getByText("작성 중", { exact: true }), 4.5, "status badge")
    await expectTextContrast(page.getByRole("button", { name: "임시 저장" }), 4.5, "primary action")
    await expect(page.locator("form[aria-busy]")).toHaveAttribute("aria-busy", "false")
    await capture(page, testInfo.project.name, "accessibility")
  })
})

async function withReadyApplicant(
  page: Page,
  testInfo: TestInfo,
  scenario: (sportId: string) => Promise<void>,
) {
  const email = testEmail(testInfo, `coach-failure-${testInfo.title}`)
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const sportId = await createReadyProfile(session.userId)
    await scenario(sportId)
  } finally {
    await cleanupLiveAuthUser(email)
  }
}

async function mockEmptyApplication(page: Page) {
  await page.route("**/api/coach-profile/me", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await route.fulfill({ contentType: "application/json", body: '{"data":null}' })
  })
}

function draftApplication(sportId: string) {
  return {
    bankAccountLast4: "1234",
    bankName: "SPOLINK 은행",
    bio: "안전한 입문 수업을 진행합니다.",
    careerYears: 4,
    certificates: [],
    headline: "입문 전문 지도자",
    id: applicationId,
    payoutHolderName: "테스트 신청자",
    primarySportId: sportId,
    rejectionReason: null,
    serviceRegion: "서울 강남구",
    status: "draft",
  }
}

async function createReadyProfile(userId: string) {
  return withDb(async (sql) => {
    await sql`
      insert into public.profiles (id, display_name, real_name, phone, default_region)
      values (${userId}, '테스트 신청자', '테스트 신청자', '010-0000-0000', '서울 강남구')
    `
    const sports = await sql<{ id: string }[]>`
      select id from public.sports where is_active = true order by name limit 1
    `
    const sportId = sports[0]?.id
    if (!sportId) throw new CoachFailureFixtureError()
    return sportId
  })
}

async function capture(page: Page, projectName: string, state: string) {
  const outputDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!outputDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    mask: [page.getByText("테스트 신청자", { exact: true }), page.getByText("010-0000-0000")],
    path: path.join(outputDir, `coach-apply-${state}-${projectName}.png`),
  })
}

async function withDb<T>(callback: (sql: postgres.Sql) => Promise<T>) {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new CoachFailureFixtureError()
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}

class CoachFailureFixtureError extends Error {
  readonly name = "CoachFailureFixtureError"

  constructor() {
    super("Coach failure-state fixture is unavailable")
  }
}
