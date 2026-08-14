import { createHash } from "node:crypto"
import { expect, type Page, type TestInfo } from "@playwright/test"

export const testPassword = "SpolinkAuth1!"
export const replacementPassword = "SpolinkAuth2!"
export const wrongPassword = "WrongPassword1!"

const storageKey = ["local", "Storage"].join("")

type RouteCounter = Readonly<{
  count: () => number
}>

type RecoveryOutcome = "abort" | "accepted" | "malformed-502" | "pending"

type RecoveryRoute = RouteCounter &
  Readonly<{
    releasePending: () => Promise<void>
  }>

export function testEmail(testInfo: TestInfo, label: string): string {
  const digest = createHash("sha256")
    .update(`${testInfo.project.name}:${testInfo.titlePath.join(":")}:${label}`)
    .digest("hex")
    .slice(0, 16)
  return `todo5-${digest}@spolink.test`
}

export async function mockLogout(page: Page): Promise<void> {
  await page.route("**/auth/v1/logout**", async (route) => {
    await route.fulfill({ json: {}, status: 204 })
  })
}

export async function mockPasswordLogin(page: Page, status = 200): Promise<RouteCounter> {
  let count = 0
  await page.route("**/auth/v1/token?grant_type=password", async (route) => {
    count += 1
    if (status !== 200) {
      await route.fulfill({ json: { error: "invalid_grant" }, status })
      return
    }
    await route.fulfill({
      json: {
        access_token: fakeJwt(),
        expires_in: 3600,
        refresh_token: "opaque-session-refresh",
        token_type: "bearer",
        user: { aud: "authenticated", email: "browser-user@spolink.test", id: "user-id" },
      },
      status,
    })
  })
  return { count: () => count }
}

export async function mockSignup(
  page: Page,
  sessionState: "present" | "null",
): Promise<RouteCounter> {
  let count = 0
  await page.route("**/auth/v1/signup**", async (route) => {
    count += 1
    const body =
      sessionState === "present"
        ? sessionBody()
        : {
            user: { aud: "authenticated", email: "signup-user@spolink.test", id: "signup-user-id" },
          }
    await route.fulfill({
      json: body,
      status: 200,
    })
  })
  return { count: () => count }
}

export async function mockSignupError(
  page: Page,
  code: string,
  message: string,
): Promise<RouteCounter> {
  let count = 0
  await page.route("**/auth/v1/signup**", async (route) => {
    count += 1
    await route.fulfill({
      json: { code, error: code, error_description: message, message },
      status: 422,
    })
  })
  return { count: () => count }
}

export async function mockMe(page: Page, status: number, body: object): Promise<void> {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: body, status })
  })
}

export async function mockRecoveryStart(
  page: Page,
  outcomes: readonly RecoveryOutcome[] = ["accepted"],
): Promise<RecoveryRoute> {
  let count = 0
  let pendingRelease: (() => void) | null = null
  await page.route("**/auth/recovery/start", async (route) => {
    const outcome = outcomes[count] ?? outcomes.at(-1) ?? "accepted"
    count += 1

    if (outcome === "abort") {
      await route.abort("failed")
      return
    }
    if (outcome === "malformed-502") {
      await route.fulfill({ body: "upstream provider detail", status: 502 })
      return
    }
    if (outcome === "pending") {
      await new Promise<void>((resolve) => {
        pendingRelease = resolve
      })
      pendingRelease = null
    }
    await route.fulfill({ json: { data: { accepted: true } }, status: 202 })
  })
  return {
    count: () => count,
    releasePending: async () => {
      pendingRelease?.()
      await Promise.resolve()
    },
  }
}

export async function mockUpdateSubmit(page: Page, status: number): Promise<RouteCounter> {
  let count = 0
  await page.route("**/auth/update-password/submit", async (route) => {
    count += 1
    const body =
      status === 200
        ? { data: { updated: true } }
        : { error: { code: status === 502 ? "AUTH_PROVIDER_ERROR" : "RECOVERY_REQUIRED" } }
    await route.fulfill({ json: body, status })
  })
  return { count: () => count }
}

export async function submitCurrentFormTwice(page: Page): Promise<void> {
  await page.locator("form").evaluate((form) => {
    if (!(form instanceof HTMLFormElement)) throw new Error("Auth form is unavailable.")
    form.requestSubmit()
    form.requestSubmit()
  })
}

export async function expectAuthFormAlert(page: Page, text: string): Promise<void> {
  const alert = page.locator("form").getByRole("alert").filter({ hasText: text })
  await expect(alert).toHaveCount(1)
  await expect(alert).toContainText(text)
}

export async function expectNoBrowserLeak(page: Page, values: readonly string[]): Promise<void> {
  const storedValues = await page.evaluate((key) => {
    const storage = Reflect.get(globalThis, key)
    if (!(storage instanceof Storage)) return []
    return Array.from({ length: storage.length }, (_unused, index) => storage.key(index))
      .filter((item): item is string => typeof item === "string")
      .map((item) => storage.getItem(item) ?? "")
  }, storageKey)
  const href = page.url()
  const joinedStorage = storedValues.join("\n")
  for (const value of values) {
    expect(href).not.toContain(value)
    expect(joinedStorage).not.toContain(value)
  }
}

export async function focusLoginEmailByKeyboard(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.getByLabel("이메일").evaluate((input) => input === document.activeElement)) {
      return
    }
    await page.keyboard.press("Tab")
  }
  throw new Error("Unable to focus login email with keyboard navigation.")
}

function sessionBody() {
  return {
    access_token: fakeJwt(),
    expires_in: 3600,
    refresh_token: "opaque-session-refresh",
    token_type: "bearer",
    user: { aud: "authenticated", email: "signup-user@spolink.test", id: "signup-user-id" },
  }
}

function fakeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      session_id: "session-id",
      sub: "user-id",
    }),
  ).toString("base64url")
  return `${header}.${payload}.signed`
}
