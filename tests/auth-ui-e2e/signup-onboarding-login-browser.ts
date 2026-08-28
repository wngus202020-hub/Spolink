import { expect, type Page, type Request, type Response } from "@playwright/test"
import type { SignupProfileInput } from "./signup-onboarding-login-helpers"

export type SignupBrowserFailedRequest = Readonly<{
  errorText: string
  path: string
}>

export type SignupRequestSummary = Readonly<{
  expectedFailures: number
  pendingRequests: number
  profileAborts: number
  totalFailures: number
  unexpectedFailures: number
}>

export type SignupProfileCreateSettlement =
  | Readonly<{ errorText: "net::ERR_ABORTED"; kind: "injected-abort" }>
  | Readonly<{ kind: "response"; status: number }>

class ProfileResponseControlError extends Error {
  readonly name = "ProfileResponseControlError"
}

export async function installProfileResponseControl(
  page: Page,
  delayInput: string | undefined,
  injectNavigationAbort: boolean,
) {
  const delayMs = readPositiveDelayMs(delayInput)
  if (injectNavigationAbort && delayMs === null) {
    throw new ProfileResponseControlError(
      "SPOLINK_AUTH_E2E_INJECT_NAV_ABORT requires SPOLINK_AUTH_E2E_PROFILE_DELAY_MS.",
    )
  }
  if (delayMs === null) {
    return { injectNavigationAbort: async (_page: Page): Promise<void> => {} }
  }

  let settleServerResponse: ((status: number) => void) | null = null
  const serverResponse = new Promise<number>((resolve) => {
    settleServerResponse = resolve
  })
  await page.route("**/api/profiles", async (route) => {
    const response = await route.fetch()
    settleServerResponse?.(response.status())
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.fulfill({ response })
  })

  return {
    async injectNavigationAbort(controlledPage: Page): Promise<void> {
      if (!injectNavigationAbort) return
      const status = await serverResponse
      if (![201, 409].includes(status)) {
        throw new ProfileResponseControlError(
          `Profile control expected 201/409, received ${status}.`,
        )
      }
      await controlledPage.goto("/lessons")
    },
  }
}

export function attachSignupRequestCollector(page: Page, allowInjectedProfileAbort: boolean) {
  const failures: SignupBrowserFailedRequest[] = []
  const pending = new Set<Request>()
  page.on("request", (request) => {
    if (isJourneyRequest(request)) pending.add(request)
  })
  page.on("response", (response) => pending.delete(response.request()))
  page.on("requestfailed", (request) => {
    pending.delete(request)
    failures.push({
      errorText: request.failure()?.errorText ?? "unknown",
      path: new URL(request.url()).pathname,
    })
  })
  return {
    summary(): SignupRequestSummary {
      const expectedFailures = failures.filter((failure) =>
        isExpectedInjectedProfileAbort(failure, allowInjectedProfileAbort),
      ).length
      return {
        expectedFailures,
        pendingRequests: pending.size,
        profileAborts: failures.filter(
          ({ errorText, path }) => errorText === "net::ERR_ABORTED" && path === "/api/profiles",
        ).length,
        totalFailures: failures.length,
        unexpectedFailures: failures.filter(
          (failure) => !isExpectedNavigationAbort(failure, allowInjectedProfileAbort),
        ).length,
      }
    },
  }
}

export function readPositiveDelayMs(value: string | undefined): number | null {
  if (value === undefined) return null
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new ProfileResponseControlError(
      "SPOLINK_AUTH_E2E_PROFILE_DELAY_MS must be a positive integer.",
    )
  }
  const delayMs = Number(value)
  if (!Number.isSafeInteger(delayMs)) {
    throw new ProfileResponseControlError(
      "SPOLINK_AUTH_E2E_PROFILE_DELAY_MS must be a safe positive integer.",
    )
  }
  return delayMs
}

export async function submitSignupProfile(page: Page, profile: SignupProfileInput): Promise<void> {
  await page.getByLabel("활동 이름").fill(profile.displayName)
  await page.getByLabel("실명").fill(profile.realName)
  await page.getByLabel("휴대폰 번호").fill(profile.phone)
  await page.getByRole("searchbox", { name: "지역 검색", exact: true }).fill("강남구")
  await page.getByRole("button", { name: "서울특별시 · 강남구", exact: true }).click()
  await expect(page.getByRole("button", { name: /서울특별시 · 강남구/u })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  if (profile.locationAgreed) {
    await page.getByLabel("내 주변 레슨 안내를 위한 위치 이용에 동의해요.").check()
  }
  if (profile.marketingAgreed) {
    await page.getByLabel("혜택과 새로운 레슨 소식 수신에 동의해요.").check()
  }
  await page.getByRole("button", { name: "레슨 찾기 시작" }).click()
}

export async function waitForProfileCreateSettlement(
  page: Page,
  expectInjectedAbort: boolean,
): Promise<SignupProfileCreateSettlement> {
  if (expectInjectedAbort) {
    const request = await page.waitForEvent("requestfailed", {
      predicate: isProfileCreateRequest,
    })
    const errorText = request.failure()?.errorText
    if (errorText !== "net::ERR_ABORTED") {
      throw new ProfileResponseControlError("Injected profile request did not abort as expected.")
    }
    return { errorText, kind: "injected-abort" }
  }
  const response = await page.waitForResponse(isProfileCreateResponse)
  return { kind: "response", status: response.status() }
}

export async function logoutSignupJourney(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/auth/logout" &&
      candidate.request().method() === "POST",
  )
  await page.getByRole("button", { name: "로그아웃" }).click()
  expect((await response).status()).toBeLessThan(400)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("link", { name: "로그인" })).toBeVisible()
}

export function isSignupResponse(response: Response): boolean {
  return (
    new URL(response.url()).pathname === "/auth/v1/signup" && response.request().method() === "POST"
  )
}

export function isProfileCreateResponse(response: Response): boolean {
  return isProfileCreateRequest(response.request())
}

export function isMeResponse(response: Response): boolean {
  return new URL(response.url()).pathname === "/api/me" && response.request().method() === "GET"
}

export function readSignupSessionPresent(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const root = Object.fromEntries(Object.entries(value))
  const nestedSession = root["session"]
  if (
    typeof nestedSession === "object" &&
    nestedSession !== null &&
    !Array.isArray(nestedSession)
  ) {
    return true
  }
  return (
    typeof root["access_token"] === "string" &&
    root["access_token"].length > 0 &&
    typeof root["refresh_token"] === "string" &&
    root["refresh_token"].length > 0
  )
}

export function isExpectedNavigationAbort(
  failure: SignupBrowserFailedRequest,
  allowInjectedProfileAbort = false,
): boolean {
  if (failure.errorText !== "net::ERR_ABORTED") return false
  return (
    (allowInjectedProfileAbort && failure.path === "/api/profiles") ||
    failure.path === "/api/me" ||
    failure.path.startsWith("/_next/static/")
  )
}

function isJourneyRequest(request: Request): boolean {
  const pathname = new URL(request.url()).pathname
  return ["/api/me", "/api/profiles", "/auth/logout", "/auth/v1/signup"].includes(pathname)
}

function isExpectedInjectedProfileAbort(
  failure: SignupBrowserFailedRequest,
  allowInjectedProfileAbort: boolean,
): boolean {
  return (
    allowInjectedProfileAbort &&
    failure.errorText === "net::ERR_ABORTED" &&
    failure.path === "/api/profiles"
  )
}

function isProfileCreateRequest(request: Request): boolean {
  return new URL(request.url()).pathname === "/api/profiles" && request.method() === "POST"
}
