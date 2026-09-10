import { writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import postgres from "postgres"
import { submitCurrentFormTwice, testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import {
  createOnboarding422RetryReceipt,
  createOnboardingScreenshotPrivacyReceipt,
  createRejectedRegionTextReceipt,
  createSingleOnboardingSubmissionReceipt,
} from "./signup-onboarding-login-helpers"

const profile = {
  defaultRegion: "서울특별시 강남구",
  displayName: "스포링커",
  phone: "010-1234-5678",
  realName: "김스포츠",
}

const onboardingDefaultRegion = "서울특별시 강남구"

test("anonymous onboarding and booking navigation use fixed login destinations", async ({
  page,
}) => {
  await page.goto("/onboarding/profile")
  await expect(page).toHaveURL(
    /\/auth\/login\?next=%2Fonboarding%2Fprofile$|\/auth\/login\?next=\/onboarding\/profile$/,
  )

  await page.goto("/lessons/tennis-gangnam/booking")
  await expect(page).toHaveURL(
    /\/auth\/login\?next=%2Flessons%2Ftennis-gangnam%2Fbooking$|\/auth\/login\?next=\/lessons\/tennis-gangnam\/booking$/,
  )
})

test("missing profile completes learner onboarding and survives refresh and logout", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "learner-onboarding")
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await page.goto("/onboarding/profile")
    await expect(page.getByRole("heading", { name: /프로필 설정/ })).toBeVisible()
    await expect(page.getByText("계정 생성의 마지막 단계")).toBeVisible()
    await expect(page.getByText("선택 동의", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "레슨 찾기 시작" })).toBeEnabled()
    await fillProfile(page)
    if (process.env["SPOLINK_VISUAL_QA_DIR"]) {
      const privacyReceipt = await captureOnboardingScreenshot(
        page,
        testInfo.project.name,
        "selected",
      )
      expect(privacyReceipt.verdict).toBe("APPROVE")
    }
    await page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.").check()
    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()
    await expect(page).toHaveURL(/\/lessons$/)
    await expect(page.getByText(profile.displayName, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(profile.displayName, { exact: true })).toBeVisible()
    await expect(readProfileRole(session.userId)).resolves.toBe("learner")
    await expect(readProfileDefaultRegion(session.userId)).resolves.toBe(onboardingDefaultRegion)

    await page.goto("/onboarding/profile")
    await expect(page).toHaveURL(/\/lessons$/)
    await page.getByRole("button", { name: "로그아웃" }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("link", { name: "로그인" })).toBeVisible()
    expect(runtimeErrors).toEqual([])
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("coach intent changes navigation only and leaves learner role", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "coach-intent")
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await page.goto("/onboarding/profile")
    await fillProfile(page)
    await page.getByLabel("지도자 등록 알아보기").check()
    await expect(page.getByRole("button", { name: "지도자 등록으로 이동" })).toBeVisible()
    await page.getByRole("button", { name: "지도자 등록으로 이동" }).click()
    await expect(page).toHaveURL(/\/coach\/apply$/)
    await expect(readProfileRole(session.userId)).resolves.toBe("learner")
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("profile onboarding sends exact payload once and preserves optional consent booleans", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "payload-boundary")
  const payloads: unknown[] = []
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.route("**/api/profiles", async (route) => {
      payloads.push(route.request().postDataJSON())
      await new Promise((resolve) => setTimeout(resolve, 250))
      await route.fulfill({ json: { data: { id: "created-profile" } }, status: 201 })
    })

    await page.goto("/onboarding/profile")
    await fillProfile(page)
    await page.getByLabel("휴대폰 번호").fill("01012345678")
    const explicitRegionSelection =
      (await page
        .getByRole("button", { name: /서울특별시 · 강남구/u })
        .getAttribute("aria-pressed")) === "true"
    await submitCurrentFormTwice(page)

    await expect(page).toHaveURL(/\/lessons$/)
    const submissionReceipt = createSingleOnboardingSubmissionReceipt({
      readExplicitRegionSelection: () => explicitRegionSelection,
      readPayloads: () => payloads,
    })
    expect(submissionReceipt).toMatchObject({ profileRequestCount: 1, verdict: "APPROVE" })
    expect(payloads).toEqual([
      {
        ...profile,
        locationAgreed: false,
        marketingAgreed: false,
      },
    ])
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("profile onboarding validates required fields and keeps selected purpose", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "validation-focus")
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.goto("/onboarding/profile")
    await page.getByLabel("지도자 등록 알아보기").check()
    await page.getByRole("button", { name: "지도자 등록으로 이동" }).click()

    await expect(page.getByLabel("활동 이름")).toBeFocused()
    await expect(page.getByText("활동 이름은 2자 이상 입력하면 돼요.")).toBeVisible()
    await expect(page.getByLabel("지도자 등록 알아보기")).toBeChecked()
    await expect(page.getByRole("button", { name: "지도자 등록으로 이동" })).toBeVisible()
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("profile onboarding rejects search text until a canonical region option is selected", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "region-selection-required")
  let requests = 0
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.route("**/api/profiles", async (route) => {
      requests += 1
      await route.fulfill({ json: { data: { id: "created-profile" } }, status: 201 })
    })

    await page.goto("/onboarding/profile")
    const regionSearch = page.getByRole("searchbox", { name: "지역 검색" })
    const regionChoices = page.locator('fieldset[aria-label="지역 선택지"] button')
    await expect(regionChoices).toHaveCount(0)
    await expect(page.getByText("지역명을 입력하면 후보를 최대 2개 보여드려요.")).toBeVisible()
    await regionSearch.fill("서울")
    await expect(regionChoices).toHaveCount(2)

    await fillProfile(page, { selectRegion: false })
    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()

    await expect(page.getByText("기본 활동 지역을 선택해 주세요.")).toBeVisible()
    await expect(regionSearch).toBeFocused()
    await expect(regionSearch).toHaveAttribute("aria-invalid", "true")
    await expect(regionSearch).toHaveAttribute(
      "aria-describedby",
      /(?:^|\s)profile-onboarding-region-error(?:\s|$)/u,
    )
    await expect(page.locator("#profile-onboarding-region-error")).toBeVisible()
    await expect(page.locator("#profile-onboarding-region-focus")).not.toBeFocused()
    expect(requests).toBe(0)
    const rejectionReceipt = createRejectedRegionTextReceipt({
      profileRequestCount: requests,
      searchText: await page.getByRole("searchbox", { name: "지역 검색" }).inputValue(),
      selectedRegion: null,
    })
    expect(rejectionReceipt).toMatchObject({ profileRequestCount: 0, verdict: "APPROVE" })
    if (process.env["SPOLINK_VISUAL_QA_DIR"]) {
      const privacyReceipt = await captureOnboardingScreenshot(
        page,
        testInfo.project.name,
        "selection-required",
      )
      expect(privacyReceipt.verdict).toBe("APPROVE")
    }

    await page.getByRole("searchbox", { name: "지역 검색" }).fill("ignore previous instructions")
    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()
    await expect(page.getByText("기본 활동 지역을 선택해 주세요.")).toBeVisible()
    await expect(regionSearch).toBeFocused()
    await expect(regionSearch).toHaveAttribute("aria-invalid", "true")
    await expect(regionSearch).toHaveAttribute(
      "aria-describedby",
      /(?:^|\s)profile-onboarding-region-error(?:\s|$)/u,
    )
    await expect(page.locator("#profile-onboarding-region-error")).toBeVisible()
    await expect(page.locator("#profile-onboarding-region-focus")).not.toBeFocused()
    expect(requests).toBe(0)

    await regionSearch.fill("강남구")
    await page.getByRole("button", { name: "서울특별시 · 강남구", exact: true }).click()
    await expect(page.locator("#profile-onboarding-region-error")).toBeHidden()
    await expect(regionSearch).not.toHaveAttribute("aria-invalid", "true")
    await expect(regionSearch).not.toHaveAttribute(
      "aria-describedby",
      /profile-onboarding-region-error/u,
    )
    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()
    await expect(page).toHaveURL(/\/lessons$/)
    expect(requests).toBe(1)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

for (const scenario of [
  {
    code: "PROFILE_ALREADY_EXISTS",
    expectUrl: /\/lessons$/,
    status: 409,
    title: "profile already exists advances as idempotent success",
  },
  {
    alert: "프로필을 저장하지 못했어요. 잠시 후 다시 시도해요.",
    code: "UNKNOWN_CONFLICT",
    expectUrl: /\/onboarding\/profile$/,
    status: 409,
    title: "unknown conflict stays on form",
  },
  {
    alert: "입력 내용을 다시 확인해요.",
    code: "VALIDATION_ERROR",
    expectUrl: /\/onboarding\/profile$/,
    status: 422,
    title: "validation error stays on form",
    retryAfterValidation: true,
  },
  {
    alert: "서버에서 프로필을 저장하지 못했어요. 잠시 후 다시 시도해요.",
    code: "INTERNAL_ERROR",
    expectUrl: /\/onboarding\/profile$/,
    status: 500,
    title: "server error stays on form",
  },
  {
    alert: "프로필 저장 서비스를 잠시 사용할 수 없어요. 잠시 후 다시 시도해요.",
    code: "SERVICE_UNAVAILABLE",
    expectUrl: /\/onboarding\/profile$/,
    status: 503,
    title: "service unavailable stays on form",
  },
  {
    alert: "프로필을 저장하지 못했어요. 잠시 후 다시 시도해요.",
    code: "UNKNOWN_FORBIDDEN",
    expectUrl: /\/onboarding\/profile$/,
    status: 403,
    title: "unknown forbidden response stays on form",
  },
] as const) {
  test(`profile onboarding ${scenario.title}`, async ({ page }, testInfo) => {
    const email = testEmail(testInfo, scenario.title)
    const payloads: unknown[] = []
    try {
      const session = await createLiveAuthSession(page, email, testPassword)
      let requests = 0
      await page.route("**/api/profiles", async (route) => {
        requests += 1
        payloads.push(route.request().postDataJSON())
        if (scenario.retryAfterValidation && requests > 1) {
          await route.continue()
          return
        }
        await route.fulfill({
          json: { error: { code: scenario.code, message: "internal details must stay hidden" } },
          status: scenario.status,
        })
      })

      await page.goto("/onboarding/profile")
      await fillProfile(page)
      if (scenario.retryAfterValidation) {
        await page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.").check()
        await page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.").check()
        await page.getByLabel("지도자 등록 알아보기").check()
      }
      await page.getByRole("button", { name: /레슨 찾기 시작|지도자 등록으로 이동/u }).click()

      await expect(page).toHaveURL(scenario.expectUrl)
      if (scenario.alert) {
        await expect(page.locator("form").getByRole("alert")).toContainText(scenario.alert)
        await expect(page.locator("form").getByRole("alert")).toBeFocused()
        await expect(page.locator("form").getByRole("alert")).not.toContainText("internal details")
        await expect(page.getByLabel("활동 이름")).toHaveValue(profile.displayName)
        if (scenario.retryAfterValidation) {
          await expect(page.getByLabel("실명")).toHaveValue(profile.realName)
          await expect(page.getByLabel("휴대폰 번호")).toHaveValue(profile.phone)
          await expect(page.getByRole("button", { name: /서울특별시 · 강남구/u })).toHaveAttribute(
            "aria-pressed",
            "true",
          )
          await expect(
            page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요."),
          ).toBeChecked()
          await expect(page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.")).toBeChecked()
          await expect(page.getByLabel("지도자 등록 알아보기")).toBeChecked()
          const retained = {
            consents:
              (await page
                .getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.")
                .isChecked()) &&
              (await page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.").isChecked()),
            identityFields:
              (await page.getByLabel("활동 이름").inputValue()) === profile.displayName &&
              (await page.getByLabel("실명").inputValue()) === profile.realName &&
              (await page.getByLabel("휴대폰 번호").inputValue()) === profile.phone,
            purpose: await page.getByLabel("지도자 등록 알아보기").isChecked(),
            regionSelection:
              (await page
                .getByRole("button", { name: /서울특별시 · 강남구/u })
                .getAttribute("aria-pressed")) === "true",
          }

          await page.getByRole("button", { name: "지도자 등록으로 이동" }).click()
          await expect(page).toHaveURL(/\/coach\/apply$/)
          expect(requests).toBe(2)
          expect(payloads).toEqual([
            {
              defaultRegion: onboardingDefaultRegion,
              displayName: profile.displayName,
              locationAgreed: true,
              marketingAgreed: true,
              phone: profile.phone,
              realName: profile.realName,
            },
            {
              defaultRegion: onboardingDefaultRegion,
              displayName: profile.displayName,
              locationAgreed: true,
              marketingAgreed: true,
              phone: profile.phone,
              realName: profile.realName,
            },
          ])
          await expect(readProfileDefaultRegion(session.userId)).resolves.toBe(
            onboardingDefaultRegion,
          )
          const retryReceipt = createOnboarding422RetryReceipt({
            firstPayload: payloads[0],
            persistedDefaultRegion: await readProfileDefaultRegion(session.userId),
            requestCount: requests,
            retained,
            secondPayload: payloads[1],
          })
          expect(retryReceipt).toMatchObject({ profileRequestCount: 2, verdict: "APPROVE" })
        }
      }
    } finally {
      await cleanupLiveAuthUser(email)
    }
  })
}

for (const scenario of [
  {
    code: "ACCOUNT_SUSPENDED",
    expectUrl: /\/auth\/restricted\?reason=account-suspended$/,
    title: "suspended account redirects to restricted route",
  },
  {
    code: "ACCOUNT_DELETED",
    expectUrl: /\/auth\/restricted\?reason=account-deleted$/,
    title: "deleted account redirects to restricted route",
  },
] as const) {
  test(`profile onboarding ${scenario.title}`, async ({ page }, testInfo) => {
    const email = testEmail(testInfo, scenario.title)
    try {
      await createLiveAuthSession(page, email, testPassword)
      await page.route("**/auth/restricted?**", async (route) => {
        await route.fulfill({ body: "restricted", contentType: "text/plain", status: 200 })
      })
      await page.route("**/api/profiles", async (route) => {
        await route.fulfill({ json: { error: { code: scenario.code } }, status: 403 })
      })

      await page.goto("/onboarding/profile")
      await fillProfile(page)
      await page.getByRole("button", { name: "레슨 찾기 시작" }).click()

      await expect(page).toHaveURL(scenario.expectUrl)
    } finally {
      await cleanupLiveAuthUser(email)
    }
  })
}

test("profile onboarding unauthenticated API response returns to login with next", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "api-unauthorized")
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.route("**/api/profiles", async (route) => {
      await route.fulfill({ json: { error: { code: "UNAUTHORIZED" } }, status: 401 })
    })

    await page.goto("/onboarding/profile")
    await fillProfile(page)
    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()

    await expect(page).toHaveURL(
      /\/auth\/login\?next=%2Fonboarding%2Fprofile$|\/auth\/login\?next=\/onboarding\/profile$/,
    )
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("profile onboarding network failure keeps values and allows retry", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "network-retry")
  let requests = 0
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.route("**/api/profiles", async (route) => {
      requests += 1
      if (requests === 1) {
        await route.abort()
        return
      }
      await route.fulfill({ json: { data: { id: "created-profile" } }, status: 201 })
    })

    await page.goto("/onboarding/profile")
    await fillProfile(page)
    await page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.").check()
    await page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.").check()
    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "연결이 원활하지 않아요. 잠시 후 다시 시도해요.",
    )
    await expect(page.locator("form").getByRole("alert")).toBeFocused()
    await expect(page.getByLabel("활동 이름")).toHaveValue(profile.displayName)
    await expect(page.getByLabel("실명")).toHaveValue(profile.realName)
    await expect(page.getByLabel("휴대폰 번호")).toHaveValue(profile.phone)
    await expect(page.getByRole("button", { name: /서울특별시 · 강남구/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.")).toBeChecked()
    await expect(page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.")).toBeChecked()

    await page.getByRole("button", { name: "레슨 찾기 시작" }).click()
    await expect(page).toHaveURL(/\/lessons$/)
    expect(requests).toBe(2)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

for (const account of [
  { alert: "현재 이용이 제한된 계정이에요.", status: "suspended" },
  { alert: "탈퇴 처리된 계정이에요.", status: "deleted" },
] as const) {
  test(`${account.status} profile is reverified and signed out through restricted route`, async ({
    page,
  }, testInfo) => {
    const email = testEmail(testInfo, account.status)
    try {
      const session = await createLiveAuthSession(page, email, testPassword)
      await createProfileForUser(session.userId)
      await setProfileStatus(session.userId, account.status)
      await page.goto("/lessons")
      await expect(page).toHaveURL(new RegExp(`/auth/login\\?error=account-${account.status}$`))
      await expect(
        page.locator("form").getByRole("alert").filter({ hasText: account.alert }),
      ).toBeVisible()
    } finally {
      await cleanupLiveAuthUser(email)
    }
  })
}

async function fillProfile(page: Page, options: Readonly<{ selectRegion?: boolean }> = {}) {
  await page.getByLabel("활동 이름").fill(profile.displayName)
  await page.getByLabel("실명").fill(profile.realName)
  await page.getByLabel("휴대폰 번호").fill(profile.phone)
  await page.getByRole("searchbox", { name: "지역 검색" }).fill("강남구")
  if (options.selectRegion !== false) {
    await page.getByRole("button", { name: "서울특별시 · 강남구", exact: true }).click()
    await expect(page.getByRole("button", { name: /서울특별시 · 강남구/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  }
}

async function captureOnboardingScreenshot(page: Page, projectName: string, label: string) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) throw new Error("SPOLINK_VISUAL_QA_DIR is required for screenshot capture.")
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  const identityMasks = [
    { evidence: "display-name" as const, locator: page.getByLabel("활동 이름") },
    { evidence: "real-name" as const, locator: page.getByLabel("실명") },
    { evidence: "phone" as const, locator: page.getByLabel("휴대폰 번호") },
  ]
  const privacyReceipt = createOnboardingScreenshotPrivacyReceipt({
    maskedIdentityEvidence: identityMasks.map(({ evidence }) => evidence),
    maskedRegionEvidence: [],
    visibleRegionEvidence:
      label === "selected" ? ["search", "selection"] : ["search", "validation"],
  })
  await page.screenshot({
    fullPage: true,
    mask: [
      ...identityMasks.map(({ locator }) => locator),
      page.locator('input[type="email"]'),
      page.locator("header, nav").getByText(/@/u),
      page.getByText(profile.displayName, { exact: true }),
      page.getByText(profile.realName, { exact: true }),
      page.getByText(profile.phone, { exact: true }),
      page.getByText(/010-\d{4}-\d{4}/u),
    ],
    maskColor: "#64748b",
    path: path.join(visualQaDir, `onboarding-${label}-${projectName}.png`),
  })
  if (label === "selection-required") {
    const regionSearch = page.getByRole("searchbox", { name: "지역 검색" })
    const describedBy = await regionSearch.getAttribute("aria-describedby")
    const accessibilityReceipt = {
      ariaDescribedBy:
        describedBy?.split(/\s+/u).includes("profile-onboarding-region-error") ?? false,
      ariaInvalid: (await regionSearch.getAttribute("aria-invalid")) === "true",
      errorId: "profile-onboarding-region-error",
      focusedSearchControl: await regionSearch.evaluate(
        (input) => document.activeElement === input,
      ),
      onlyRegionError: await page.getByText("기본 활동 지역을 선택해 주세요.").isVisible(),
      project: projectName,
      scenario: "missing-region",
      type: "todo15-onboarding-region-accessibility-receipt",
      visible: await page.locator("#profile-onboarding-region-error").isVisible(),
    }
    const verdict =
      accessibilityReceipt.ariaDescribedBy &&
      accessibilityReceipt.ariaInvalid &&
      accessibilityReceipt.focusedSearchControl &&
      accessibilityReceipt.onlyRegionError &&
      accessibilityReceipt.visible
        ? "APPROVE"
        : "REJECT"
    expect(verdict).toBe("APPROVE")
    await writeFile(
      path.join(visualQaDir, `onboarding-region-accessibility-${projectName}.json`),
      `${JSON.stringify({ ...accessibilityReceipt, verdict }, null, 2)}\n`,
      { mode: 0o600 },
    )
  }
  return privacyReceipt
}

async function withDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await run(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function readProfileRole(userId: string) {
  return withDb(
    async (sql) => (await sql`select role from public.profiles where id = ${userId}`)[0]?.["role"],
  )
}

async function readProfileDefaultRegion(userId: string) {
  return withDb(
    async (sql) =>
      (await sql`select default_region from public.profiles where id = ${userId}`)[0]?.[
        "default_region"
      ],
  )
}

async function createProfileForUser(userId: string) {
  await withDb(async (sql) => {
    await sql`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${userId}, ${profile.displayName}, ${profile.realName}, ${profile.phone}, ${profile.defaultRegion})`
  })
}

async function setProfileStatus(userId: string, status: "deleted" | "suspended") {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`
      await tx`update public.profiles set status = ${status}, deleted_at = ${status === "deleted" ? new Date().toISOString() : null} where id = ${userId}`
    })
  })
}
