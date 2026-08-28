import { randomUUID } from "node:crypto"
import type { ConsoleMessage, Page, TestInfo } from "@playwright/test"
import postgres from "postgres"
import { isCanonicalProfileRegion } from "@/lib/profile/region-contract"
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
  defaultRegion: "서울특별시 강남구",
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

export class SignupOnboardingObservationError extends Error {
  constructor() {
    super("Observed onboarding behavior did not match the expected contract.")
    this.name = "SignupOnboardingObservationError"
  }
}

type RetainedOnboardingState = Readonly<
  Record<"consents" | "identityFields" | "purpose" | "regionSelection", boolean>
>

type SingleOnboardingObservationSource = Readonly<{
  readExplicitRegionSelection: () => boolean
  readPayloads: () => readonly unknown[]
}>

export function createSingleOnboardingSubmissionReceipt(source: SingleOnboardingObservationSource) {
  const observation = {
    explicitRegionSelection: source.readExplicitRegionSelection(),
    payloads: source.readPayloads(),
  }
  assertSingleOnboardingSubmissionObservation(observation)
  const payload = observation.payloads[0]
  if (!isSignupProfileInput(payload)) throw new SignupOnboardingObservationError()
  return {
    defaultRegion: payload.defaultRegion,
    kind: "single-submission",
    profileRequestCount: 1,
    verdict: "APPROVE",
  } as const
}

export function assertSingleOnboardingSubmissionObservation(
  observation: Readonly<{
    explicitRegionSelection: boolean
    payloads: readonly unknown[]
  }>,
): void {
  if (
    !observation.explicitRegionSelection ||
    observation.payloads.length !== 1 ||
    !isSignupProfileInput(observation.payloads[0])
  ) {
    throw new SignupOnboardingObservationError()
  }
}

export function assertRejectedRegionTextObservation(
  observation: Readonly<{
    profileRequestCount: number
    searchText: string
    selectedRegion: string | null
  }>,
): void {
  if (
    observation.searchText.length === 0 ||
    observation.selectedRegion !== null ||
    observation.profileRequestCount !== 0
  ) {
    throw new SignupOnboardingObservationError()
  }
}

export function createRejectedRegionTextReceipt(
  observation: Parameters<typeof assertRejectedRegionTextObservation>[0],
) {
  assertRejectedRegionTextObservation(observation)
  return {
    kind: "region-text-rejected",
    profileRequestCount: 0,
    verdict: "APPROVE",
  } as const
}

export function assertOnboarding422RetryObservation(
  observation: Readonly<{
    firstPayload: unknown
    persistedDefaultRegion: string | null
    requestCount: number
    retained: RetainedOnboardingState
    secondPayload: unknown
  }>,
): void {
  const { firstPayload, persistedDefaultRegion, requestCount, retained, secondPayload } =
    observation
  if (
    requestCount !== 2 ||
    !Object.values(retained).every(Boolean) ||
    !isSignupProfileInput(firstPayload) ||
    !isSignupProfileInput(secondPayload) ||
    !sameSignupProfileInput(firstPayload, secondPayload) ||
    persistedDefaultRegion !== secondPayload.defaultRegion
  ) {
    throw new SignupOnboardingObservationError()
  }
}

export function createOnboarding422RetryReceipt(
  observation: Parameters<typeof assertOnboarding422RetryObservation>[0],
) {
  assertOnboarding422RetryObservation(observation)
  return {
    kind: "validation-retry",
    persistedDefaultRegion: observation.persistedDefaultRegion,
    profileRequestCount: 2,
    verdict: "APPROVE",
  } as const
}

type IdentityEvidenceKind = "display-name" | "phone" | "real-name"
type RegionEvidenceKind = "search" | "selection" | "validation"

export function createOnboardingScreenshotPrivacyReceipt(
  observation: Readonly<{
    maskedIdentityEvidence: readonly IdentityEvidenceKind[]
    maskedRegionEvidence: readonly RegionEvidenceKind[]
    visibleRegionEvidence: readonly RegionEvidenceKind[]
  }>,
) {
  const identities = new Set(observation.maskedIdentityEvidence)
  const regions = new Set(observation.visibleRegionEvidence)
  if (
    identities.size !== 3 ||
    !identities.has("display-name") ||
    !identities.has("real-name") ||
    !identities.has("phone") ||
    observation.maskedRegionEvidence.length !== 0 ||
    !regions.has("search") ||
    (!regions.has("selection") && !regions.has("validation"))
  ) {
    throw new SignupOnboardingObservationError()
  }
  return {
    kind: "screenshot-privacy",
    maskedIdentityEvidence: [...identities].sort(),
    visibleRegionEvidence: [...regions].sort(),
    verdict: "APPROVE",
  } as const
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

const signupProfileKeys = [
  "defaultRegion",
  "displayName",
  "locationAgreed",
  "marketingAgreed",
  "phone",
  "realName",
] as const satisfies readonly (keyof SignupProfileInput)[]

function isSignupProfileInput(value: unknown): value is SignupProfileInput {
  if (!isUnknownRecord(value)) return false
  const input = value
  return (
    Object.keys(input).length === signupProfileKeys.length &&
    signupProfileKeys.every((key) => key in input) &&
    typeof input["defaultRegion"] === "string" &&
    isCanonicalProfileRegion(input["defaultRegion"]) &&
    typeof input["displayName"] === "string" &&
    typeof input["locationAgreed"] === "boolean" &&
    typeof input["marketingAgreed"] === "boolean" &&
    typeof input["phone"] === "string" &&
    typeof input["realName"] === "string"
  )
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sameSignupProfileInput(left: SignupProfileInput, right: SignupProfileInput): boolean {
  return signupProfileKeys.every((key) => left[key] === right[key])
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
