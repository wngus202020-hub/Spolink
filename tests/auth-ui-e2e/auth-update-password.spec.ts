import { expect, type Response, test } from "@playwright/test"
import {
  expectNoBrowserLeak,
  mockUpdateSubmit,
  replacementPassword,
  testEmail,
  testPassword,
} from "./auth-form-helpers"
import {
  cleanupLiveAuthUser,
  createLiveAuthSession,
  createLiveRecoveryMarker,
  issueLiveRecoveryGrant,
  makeExpiredRecoveryMarker,
  makeTamperedRecoveryMarker,
  probeLiveRecoveryGrant,
} from "./auth-recovery-helpers"

type SubmitResponseCapture = Readonly<{
  errorCode: string | null
  status: number
}>

const submitErrorCodeByStatus = new Map<number, string>([
  [403, "RECOVERY_REQUIRED"],
  [502, "AUTH_PROVIDER_ERROR"],
])

test("update-password missing marker redirects to reset before rendering form", async ({
  page,
}) => {
  await page.goto("/auth/update-password")

  await expect(page).toHaveURL(/\/auth\/reset-password\?error=recovery-required$/)
  await expect(page.getByLabel("새 비밀번호")).toHaveCount(0)
})

test("update-password tampered marker redirects to reset before rendering form", async ({
  page,
}) => {
  await page.goto("/")
  await page.context().addCookies([
    {
      httpOnly: true,
      name: "spolink_recovery",
      sameSite: "Lax",
      url: new URL(page.url()).origin,
      value: makeTamperedRecoveryMarker(),
    },
  ])

  await page.goto("/auth/update-password")

  await expect(page).toHaveURL(/\/auth\/reset-password\?error=recovery-required$/)
  await expect(page.getByLabel("새 비밀번호")).toHaveCount(0)
})

test("update-password expired marker redirects to reset before rendering form", async ({
  page,
}) => {
  await page.goto("/")
  await page.context().addCookies([
    {
      httpOnly: true,
      name: "spolink_recovery",
      sameSite: "Lax",
      url: new URL(page.url()).origin,
      value: makeExpiredRecoveryMarker(),
    },
  ])

  await page.goto("/auth/update-password")

  await expect(page).toHaveURL(/\/auth\/reset-password\?error=recovery-required$/)
  await expect(page.getByLabel("새 비밀번호")).toHaveCount(0)
})

test("valid verified recovery marker renders and successful submit clears marker", async ({
  page,
}, testInfo) => {
  test.skip(!process.env["SPOLINK_AUTH_E2E_DB_URL"], "live Supabase DB URL is required")
  const email = testEmail(testInfo, "valid-recovery")
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const marker = await createLiveRecoveryMarker(page, session)
    await issueLiveRecoveryGrant(marker)

    await page.goto("/auth/update-password")
    await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeVisible()
    await expect(probeLiveRecoveryGrant(marker, session)).resolves.toEqual({
      grantExists: true,
      grantIsActive: true,
      grantSessionMatchesMarker: true,
      grantUserMatchesMarker: true,
      sessionCookieMatchesMarker: true,
      sessionUserMatchesMarker: true,
    })
    await page.getByLabel("새 비밀번호", { exact: true }).fill(replacementPassword)
    await page.getByLabel("새 비밀번호 확인").fill(replacementPassword)
    const response = page.waitForResponse("**/auth/update-password/submit")
    await page.getByRole("button", { name: /비밀번호 변경/ }).click()

    const submitCapture = logSubmitResponseCapture(await response)
    expect(submitCapture).toEqual({ errorCode: null, status: 200 })
    await expect(page).toHaveURL(/\/onboarding\/profile$/)
    expectCanonicalLocation(page.url(), "/onboarding/profile")
    await expect(page.getByLabel("새 비밀번호", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /비밀번호 변경/ })).toHaveCount(0)
    const cookies = await page.context().cookies()
    expect(
      cookies
        .filter((cookie) => cookie.name === "spolink_recovery")
        .map(({ domain, httpOnly, path, sameSite, secure }) => ({
          domain,
          httpOnly,
          path,
          sameSite,
          secure,
        })),
    ).toEqual([])
    await expectNoBrowserLeak(page, [email, testPassword, replacementPassword, marker.token])
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("replayed valid marker renders then submit returns 403 and routes to fresh reset", async ({
  page,
}, testInfo) => {
  test.skip(!process.env["SPOLINK_AUTH_E2E_DB_URL"], "live Supabase DB URL is required")
  const email = testEmail(testInfo, "replayed-recovery")
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const marker = await createLiveRecoveryMarker(page, session)

    await page.goto("/auth/update-password")
    await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeVisible()
    await page.getByLabel("새 비밀번호", { exact: true }).fill(replacementPassword)
    await page.getByLabel("새 비밀번호 확인").fill(replacementPassword)
    const response = page.waitForResponse("**/auth/update-password/submit")
    await page.getByRole("button", { name: /비밀번호 변경/ }).click()

    const submitCapture = logSubmitResponseCapture(await response)
    expect(submitCapture).toEqual({ errorCode: "RECOVERY_REQUIRED", status: 403 })
    await expect(page).toHaveURL(/\/auth\/reset-password\?error=recovery-required$/)
    await expectNoBrowserLeak(page, [email, testPassword, replacementPassword, marker.token])
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("provider 502 clears form state and requires a new reset", async ({ page }, testInfo) => {
  test.skip(!process.env["SPOLINK_AUTH_E2E_DB_URL"], "live Supabase DB URL is required")
  const email = testEmail(testInfo, "provider-502")
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await createLiveRecoveryMarker(page, session)
    const update = await mockUpdateSubmit(page, 502)

    await page.goto("/auth/update-password")
    await page.getByLabel("새 비밀번호", { exact: true }).fill(replacementPassword)
    await page.getByLabel("새 비밀번호 확인").fill(replacementPassword)
    const response = page.waitForResponse("**/auth/update-password/submit")
    await page.getByRole("button", { name: /비밀번호 변경/ }).click()

    const submitCapture = logSubmitResponseCapture(await response)
    expect(submitCapture).toEqual({ errorCode: "AUTH_PROVIDER_ERROR", status: 502 })
    await expect.poll(update.count).toBe(1)
    await expect(page).toHaveURL(/\/auth\/reset-password\?error=recovery-required$/)
    await expect(page.getByLabel("이메일")).toBeVisible()
    await expectNoBrowserLeak(page, [email, testPassword, replacementPassword])
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

function logSubmitResponseCapture(response: Response): SubmitResponseCapture {
  const capture = redactedSubmitResponseCapture(response)
  console.info(`SUBMIT_RESPONSE_REDACTED ${JSON.stringify(capture)}`)
  return capture
}

function redactedSubmitResponseCapture(response: Response): SubmitResponseCapture {
  const status = response.status()
  return {
    errorCode: status === 200 ? null : (submitErrorCodeByStatus.get(status) ?? null),
    status,
  }
}

function expectCanonicalLocation(currentUrl: string, pathname: string): void {
  const url = new URL(currentUrl)
  expect(url.pathname).toBe(pathname)
  expect(url.search).toBe("")
}
