import { expect, type Page, type TestInfo, test } from "@playwright/test"
import postgres from "postgres"
import { deleteVerificationMessage, waitForVerificationMessage } from "./mailpit.mjs"
import {
  attachSignupRequestCollector,
  installProfileResponseControl,
  isMeResponse,
  isSignupResponse,
  logoutSignupJourney,
  readSignupSessionPresent,
  submitSignupProfile,
  waitForProfileCreateSettlement,
} from "./signup-onboarding-login-browser"
import {
  assertPersistedSignupProfile,
  attachBrowserFailureCollector,
  createSignupJourneyFixture,
  readPersistedSignupProfile,
  runWithSignupCleanup,
} from "./signup-onboarding-login-helpers"

const confirmations = process.env["SPOLINK_AUTH_E2E_CONFIRMATIONS"] === "true"
const allowInjectedProfileAbort = process.env["SPOLINK_AUTH_E2E_INJECT_NAV_ABORT"] === "1"
const apiUrl = process.env["SPOLINK_AUTH_E2E_API_URL"] ?? ""
const baseUrl = process.env["SPOLINK_AUTH_E2E_BASE_URL"] ?? ""

test("confirmation-off real signup persists profile and supports password re-login", async ({
  page,
}, testInfo) => {
  test.skip(confirmations, "Confirmation-on signup belongs to the Mailpit journey.")
  await runSignupJourney(page, testInfo, "confirmation-off")
})

test("confirmation-on real signup confirms email, persists profile, and supports password re-login", async ({
  page,
}, testInfo) => {
  test.skip(!confirmations, "Confirmation-off signup does not use Mailpit.")
  await runSignupJourney(page, testInfo, "confirmation-on")
})

async function runSignupJourney(
  page: Page,
  testInfo: TestInfo,
  mode: "confirmation-off" | "confirmation-on",
): Promise<void> {
  const fixture = createSignupJourneyFixture(testInfo, mode)
  const browserFailures = attachBrowserFailureCollector(page)
  const requestCollector = attachSignupRequestCollector(page, allowInjectedProfileAbort)
  const profileControl = await installProfileResponseControl(
    page,
    process.env["SPOLINK_AUTH_E2E_PROFILE_DELAY_MS"],
    allowInjectedProfileAbort,
  )
  const network = {
    callback: 0,
    me: 0,
    profiles: 0,
    signup: 0,
    unexpectedResponses: 0,
    verify: 0,
  }
  const cleanupOrder: string[] = []
  let authProfileIdentityMatched = false
  let dbProfileVerified = false
  let finalLogoutPathname: string | null = null
  let mailpitMessageDeleted = mode === "confirmation-off"
  let mailpitRecipientMessages = 0
  let mailpitVerifyLinks = 0
  let meStatus: number | null = null
  let postLogoutNext: string | null = null
  let profileStatus: number | null = null
  let profileNavigationPathname: string | null = null
  let redirectToMatches = mode === "confirmation-off"
  let reloginPathname: string | null = null
  let signupStatus: number | null = null
  let signupSessionPresent: boolean | null = null
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname
    if (path === "/auth/v1/signup") network.signup += 1
    if (path === "/auth/v1/verify") network.verify += 1
    if (path === "/auth/callback") network.callback += 1
    if (path === "/api/profiles" && response.request().method() === "POST") network.profiles += 1
    if (path === "/api/me") network.me += 1
    if (response.status() >= 400) network.unexpectedResponses += 1
  })

  let journeyFailure: unknown = null
  try {
    await runWithSignupCleanup(fixture.email, async () => {
      let messageId: string | null = null
      try {
        await page.goto("/auth/signup")
        await page.getByLabel("이메일").fill(fixture.email)
        await page.getByLabel("비밀번호", { exact: true }).fill(fixture.password)
        await page.getByLabel("비밀번호 확인").fill(fixture.password)
        const signupResponse = page.waitForResponse(isSignupResponse)
        await page.getByRole("button", { name: /계정 만들기/ }).click()
        const signup = await signupResponse
        signupStatus = signup.status()
        expect(signupStatus).toBe(200)
        const signupResult = readSignupResult(await signup.json())
        signupSessionPresent = signupResult.sessionPresent
        expect(signupSessionPresent).toBe(mode === "confirmation-off")

        if (mode === "confirmation-on") {
          await expect(page).toHaveURL(/\/auth\/check-email$/)
          const expectedRedirectTo = `${baseUrl}/auth/callback`
          const message = await waitForVerificationMessage({
            apiUrl,
            recipient: fixture.email,
            redirectTo: expectedRedirectTo,
            type: "signup",
          })
          messageId = message.id
          mailpitRecipientMessages = 1
          mailpitVerifyLinks = 1
          redirectToMatches =
            new URL(message.href).searchParams.get("redirect_to") === expectedRedirectTo
          expect(redirectToMatches).toBe(true)
          injectFailure("after-mailpit-link")
          await page.goto(message.href)
        }
        await expect(page).toHaveURL(/\/onboarding\/profile$/)

        injectFailure("after-signup")
        const profileSettlement = waitForProfileCreateSettlement(page, allowInjectedProfileAbort)
        await submitSignupProfile(page, fixture.profile)
        await profileControl.injectNavigationAbort(page)
        const profileResult = await profileSettlement
        if (profileResult.kind === "response") {
          profileStatus = profileResult.status
          expect(profileStatus).toBe(201)
        } else {
          expect(allowInjectedProfileAbort).toBe(true)
        }
        await expect(page).toHaveURL(/\/lessons$/)
        profileNavigationPathname = new URL(page.url()).pathname
        await expect(page.getByText(fixture.profile.displayName, { exact: true })).toBeVisible()

        const persisted = await readPersistedSignupProfile(fixture.email)
        assertPersistedSignupProfile(persisted, signupResult.authUserId, fixture.profile)
        dbProfileVerified = true
        authProfileIdentityMatched = true
        await page.reload()
        await expect(page).toHaveURL(/\/lessons$/)
        await expect(page.getByText(fixture.profile.displayName, { exact: true })).toBeVisible()
        await page.goto("/onboarding/profile")
        await expect(page).toHaveURL(/\/lessons$/)

        await logoutSignupJourney(page)
        await page.goto("/onboarding/profile")
        const protectedLocation = new URL(page.url())
        expect(protectedLocation.pathname).toBe("/auth/login")
        postLogoutNext = protectedLocation.searchParams.get("next")
        expect(postLogoutNext).toBe("/onboarding/profile")

        await page.getByLabel("이메일").fill(fixture.email)
        await page.getByLabel("비밀번호", { exact: true }).fill(fixture.password)
        const meResponse = page.waitForResponse(isMeResponse)
        await page.getByRole("button", { name: /^로그인$/ }).click()
        meStatus = (await meResponse).status()
        expect(meStatus).toBe(200)
        await expect(page).toHaveURL(/\/lessons$/)
        await expect(page.getByText(fixture.profile.displayName, { exact: true })).toBeVisible()
        reloginPathname = new URL(page.url()).pathname

        await logoutSignupJourney(page)
        finalLogoutPathname = new URL(page.url()).pathname
      } finally {
        if (messageId !== null) {
          await deleteVerificationMessage(messageId)
          mailpitMessageDeleted = true
          cleanupOrder.push("mailpit-message")
        }
      }
    })
  } catch (error) {
    journeyFailure = error
  }

  const authUserDeleted = (await readAuthUserCount(fixture.email)) === 0
  if (authUserDeleted) cleanupOrder.push("auth-user")
  console.log(JSON.stringify({ authUserDeleted, event: "cleanup", project: testInfo.project.name }))
  const requestSummary = requestCollector.summary()
  const browserSummary = browserFailures.summary()
  console.log(
    JSON.stringify({
      browserSummary,
      authProfileIdentityMatched,
      cleanupOrder,
      dbProfileVerified,
      event: "manual-qa",
      finalLogoutPathname,
      mailpitMessageDeleted,
      mailpitRecipientMessages,
      mailpitVerifyLinks,
      meStatus,
      mode,
      network,
      postLogoutNext,
      profileStatus,
      profileNavigationPathname,
      project: testInfo.project.name,
      redirectToMatches,
      reloginPathname,
      signupStatus,
      signupSessionPresent,
      requestSummary,
    }),
  )
  expect(authUserDeleted).toBe(true)
  if (journeyFailure !== null) throw journeyFailure
  expect(network).toEqual({
    callback: mode === "confirmation-on" ? 1 : 0,
    me: 1,
    profiles: allowInjectedProfileAbort ? 0 : 1,
    signup: 1,
    unexpectedResponses: 0,
    verify: mode === "confirmation-on" ? 1 : 0,
  })
  expect(requestSummary.unexpectedFailures).toBe(0)
  expect(requestSummary.pendingRequests).toBe(0)
  expect(requestSummary.profileAborts).toBe(allowInjectedProfileAbort ? 1 : 0)
  if (allowInjectedProfileAbort) expect(requestSummary.expectedFailures).toBe(1)
  expect(browserSummary.consoleErrors).toBe(0)
  expect(browserSummary.pageErrors).toBe(0)
  expect(browserSummary.requestFailures).toBe(requestSummary.totalFailures)
}

function readSignupResult(value: unknown): Readonly<{
  authUserId: string
  sessionPresent: boolean
}> {
  const root = toRecord(value)
  const user = toRecord(root?.["user"]) ?? root
  const id = user?.["id"]
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Signup response did not contain an Auth user id.")
  }
  return { authUserId: id, sessionPresent: readSignupSessionPresent(root) }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value))
}

async function readAuthUserCount(email: string): Promise<number> {
  const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    const [row] = await sql`select count(*)::int as count from auth.users where email = ${email}`
    return typeof row?.["count"] === "number" ? row["count"] : -1
  } finally {
    await sql.end({ timeout: 1 })
  }
}

function injectFailure(point: string): void {
  if (process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"] === point) {
    expect(point).toBe("forced-mid-flow-failure")
  }
}
