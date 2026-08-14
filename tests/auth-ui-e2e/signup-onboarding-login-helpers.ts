import { randomUUID } from "node:crypto"
import type { ConsoleMessage, Page, TestInfo } from "@playwright/test"
import postgres from "postgres"
import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser } from "./auth-recovery-helpers"

export type SignupProfileInput = Readonly<{
  defaultRegion: string
  displayName: string
  locationAgreed: boolean
  marketingAgreed: boolean
  phone: string
  realName: string
}>

export type PersistedSignupProfile = Readonly<{
  authUserId: string
  defaultRegion: string | null
  displayName: string
  locationAgreedAt: string | null
  marketingAgreedAt: string | null
  phone: string | null
  profileId: string
  realName: string | null
  role: string
  status: string
}>

type SignupJourneyFixture = Readonly<{
  email: string
  password: string
  profile: SignupProfileInput
}>

type BrowserFailureSummary = Readonly<{
  consoleErrors: number
  pageErrors: number
  requestFailures: number
}>

type BrowserFailureCollector = Readonly<{
  summary: () => BrowserFailureSummary
}>

type Settled<T> =
  | Readonly<{ error: unknown; status: "failure" }>
  | Readonly<{ status: "success"; value: T }>

export const signupProfileInput = {
  defaultRegion: "서울 강남구",
  displayName: "스포링커",
  locationAgreed: true,
  marketingAgreed: false,
  phone: "010-1234-5678",
  realName: "김스포츠",
} as const satisfies SignupProfileInput

export class SignupProfileAssertionError extends Error {
  constructor() {
    super("Persisted signup profile did not match the expected contract.")
    this.name = "SignupProfileAssertionError"
  }
}

export class SignupCleanupError extends Error {
  readonly cleanupFailureName: string | null
  readonly primaryFailureName: string | null

  constructor(primaryFailureName: string | null, cleanupFailureName: string | null) {
    super(
      primaryFailureName && cleanupFailureName
        ? "Signup journey failed and cleanup did not complete."
        : primaryFailureName
          ? "Signup journey failed before cleanup completed."
          : "Signup cleanup did not complete.",
    )
    this.name = "SignupCleanupError"
    this.primaryFailureName = primaryFailureName
    this.cleanupFailureName = cleanupFailureName
  }
}

export function createSignupJourneyFixture(
  testInfo: TestInfo,
  label: string,
): SignupJourneyFixture {
  return {
    email: testEmail(testInfo, `${label}-${randomUUID()}`),
    password: testPassword,
    profile: signupProfileInput,
  }
}

export async function readPersistedSignupProfile(
  email: string,
): Promise<PersistedSignupProfile | null> {
  const status = await readGuardedLocalStatus()
  const sql = postgres(status.dbUrl, { idle_timeout: 1, max: 1 })
  try {
    const [profile] = await sql<PersistedSignupProfile[]>`
      select
        auth_users.id::text as "authUserId",
        profiles.id::text as "profileId",
        profiles.role::text as role,
        profiles.status::text as status,
        profiles.display_name as "displayName",
        profiles.real_name as "realName",
        profiles.phone,
        profiles.default_region as "defaultRegion",
        profiles.location_agreed_at::text as "locationAgreedAt",
        profiles.marketing_agreed_at::text as "marketingAgreedAt"
      from auth.users as auth_users
      join public.profiles as profiles on profiles.id = auth_users.id
      where auth_users.email = ${email}
    `
    return profile ?? null
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export function assertPersistedSignupProfile(
  profile: PersistedSignupProfile | null,
  expectedAuthUserId: string,
  expected: SignupProfileInput,
): void {
  const matches =
    profile !== null &&
    profile.authUserId === expectedAuthUserId &&
    profile.profileId === expectedAuthUserId &&
    profile.profileId === profile.authUserId &&
    profile.role === "learner" &&
    profile.status === "active" &&
    profile.displayName === expected.displayName &&
    profile.realName === expected.realName &&
    profile.phone === expected.phone &&
    profile.defaultRegion === expected.defaultRegion &&
    consentMatches(profile.locationAgreedAt, expected.locationAgreed) &&
    consentMatches(profile.marketingAgreedAt, expected.marketingAgreed)

  if (!matches) throw new SignupProfileAssertionError()
}

export function attachBrowserFailureCollector(page: Page): BrowserFailureCollector {
  let consoleErrors = 0
  let pageErrors = 0
  let requestFailures = 0
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors += 1
  })
  page.on("pageerror", () => {
    pageErrors += 1
  })
  page.on("requestfailed", () => {
    requestFailures += 1
  })
  return {
    summary: () => ({ consoleErrors, pageErrors, requestFailures }),
  }
}

export async function runWithSignupCleanup<T>(
  email: string,
  operation: () => Promise<T>,
  cleanup: (fixtureEmail: string) => Promise<void> = cleanupLiveAuthUser,
): Promise<T> {
  let operationResult: Settled<T> | null = null
  let cleanupFailure: unknown = null
  try {
    operationResult = await settle(operation)
  } finally {
    const cleanupResult = await settle(() => cleanup(email))
    if (cleanupResult.status === "failure") cleanupFailure = cleanupResult.error
  }

  if (operationResult === null) {
    throw new SignupCleanupError("UnknownFailure", failureName(cleanupFailure))
  }
  if (operationResult.status === "failure") {
    throw new SignupCleanupError(failureName(operationResult.error), failureName(cleanupFailure))
  }
  if (cleanupFailure !== null) throw new SignupCleanupError(null, failureName(cleanupFailure))
  return operationResult.value
}

function consentMatches(value: string | null, agreed: boolean): boolean {
  if (!agreed) return value === null
  return value !== null && !Number.isNaN(Date.parse(value))
}

function failureName(error: unknown): string | null {
  if (error === null) return null
  return error instanceof Error && error.name ? error.name : "UnknownFailure"
}

async function settle<T>(operation: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { status: "success", value: await operation() }
  } catch (error) {
    return { error, status: "failure" }
  }
}
