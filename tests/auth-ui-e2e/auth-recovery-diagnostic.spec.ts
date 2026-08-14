import { expect, type Response, test } from "@playwright/test"
import { replacementPassword, testEmail, testPassword } from "./auth-form-helpers"
import {
  consumeRecoveryGrantWithCanonicalAccessToken,
  probeRecoveryGrantState,
  readBrowserClaimsDiagnostic,
  readPostCookieDiagnostic,
} from "./auth-recovery-diagnostic-helpers"
import {
  cleanupLiveAuthUser,
  createLiveAuthSession,
  createLiveRecoveryMarker,
  issueLiveRecoveryGrant,
  probeLiveRecoveryGrant,
} from "./auth-recovery-helpers"

type RouteCapture = Readonly<{
  errorCode: string | null
  status: number
}>

type RecoveryBoundaryDiagnostic = Readonly<{
  authCookieCount: number
  browserSessionMatches: boolean
  browserUserMatches: boolean
  directRpcData: boolean | null
  directRpcError: Readonly<{ code: string | null; messageClass: string }>
  grantActiveAfter: boolean
  grantConsumedAfter: boolean
  markerCookiePresent: boolean
  routeErrorCode: string | null
  routeStatus: number
}>

const routeErrorCodeByStatus = new Map<number, string>([
  [401, "UNAUTHORIZED"],
  [403, "RECOVERY_REQUIRED"],
  [422, "VALIDATION_ERROR"],
  [502, "AUTH_PROVIDER_ERROR"],
  [503, "AUTH_FLOW_NOT_CONFIGURED"],
])

test("diagnoses recovery grant boundary with direct rpc and browser submit", async ({
  page,
}, testInfo) => {
  test.skip(!process.env["SPOLINK_AUTH_E2E_DB_URL"], "live Supabase DB URL is required")
  const email = testEmail(testInfo, "recovery-boundary-diagnostic")
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    const markerA = await createLiveRecoveryMarker(page, session)
    await issueLiveRecoveryGrant(markerA)
    const directRpc = await consumeRecoveryGrantWithCanonicalAccessToken(markerA, session)

    const markerB = await createLiveRecoveryMarker(page, session)
    await issueLiveRecoveryGrant(markerB)
    await expect(probeLiveRecoveryGrant(markerB, session)).resolves.toEqual({
      grantExists: true,
      grantIsActive: true,
      grantSessionMatchesMarker: true,
      grantUserMatchesMarker: true,
      sessionCookieMatchesMarker: true,
      sessionUserMatchesMarker: true,
    })

    await page.goto("/auth/update-password")
    await expect(page.getByLabel("새 비밀번호", { exact: true })).toBeVisible()
    const browserClaims = await readBrowserClaimsDiagnostic(page, markerB)
    await page.getByLabel("새 비밀번호", { exact: true }).fill(replacementPassword)
    await page.getByLabel("새 비밀번호 확인").fill(replacementPassword)

    const requestPromise = page.waitForRequest("**/auth/update-password/submit")
    const responsePromise = page.waitForResponse("**/auth/update-password/submit")
    await page.getByRole("button", { name: /비밀번호 변경/ }).click()

    const request = await requestPromise
    const routeCapture = readRouteCapture(await responsePromise)
    const postCookies = readPostCookieDiagnostic(request.headers()["cookie"])
    const grantAfter = await probeRecoveryGrantState(markerB)
    const diagnostic = {
      authCookieCount: postCookies.authCookieCount,
      browserSessionMatches: browserClaims.sessionMatchesMarker,
      browserUserMatches: browserClaims.userMatchesMarker,
      directRpcData: directRpc.data,
      directRpcError: directRpc.error,
      grantActiveAfter: grantAfter.active,
      grantConsumedAfter: grantAfter.consumed,
      markerCookiePresent: postCookies.markerCookiePresent,
      routeErrorCode: routeCapture.errorCode,
      routeStatus: routeCapture.status,
    } satisfies RecoveryBoundaryDiagnostic

    console.info(`RECOVERY_BOUNDARY_DIAGNOSTIC_REDACTED ${JSON.stringify(diagnostic)}`)
    expect(diagnostic.markerCookiePresent).toBe(true)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

function readRouteCapture(response: Response): RouteCapture {
  const status = response.status()
  if (status === 200) return { errorCode: null, status }
  return { errorCode: routeErrorCodeByStatus.get(status) ?? null, status }
}
