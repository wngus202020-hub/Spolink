import { chmod, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Page, type Request, type TestInfo } from "@playwright/test"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import {
  assertBrowserDiagnosticsClean,
  attachLearnerReservationBrowserDiagnostics,
  type BrowserDiagnosticsReceipt,
} from "./learner-reservations-browser-diagnostics"
import { downloadCalendar } from "./learner-reservations-calendar-assertions"
import {
  assertCompletionPersistence,
  assertCompletionSuccessSurface,
  assertNonSuccessCompletionRoutes,
} from "./learner-reservations-completion-assertions"
import {
  assertCompletionNotFoundRoutes,
  assertCompletionRecoverySurface,
} from "./learner-reservations-completion-recovery"
import {
  cleanupLearnerReservationFixtures,
  ownedLessonTitle,
  seedLearnerReservationFixtures,
} from "./learner-reservations-fixtures"
import {
  type PhaseReceipt,
  runReservationPhase,
  safePathname,
} from "./learner-reservations-page-helpers"
import { isForbiddenReadOnlyRequest } from "./learner-reservations-request-guards"
import {
  assertMyPageHeading,
  assertMyPageProfile,
  assertReservationNavigation,
} from "./learner-reservations-route-assertions"
import { runLearnerReservationPhases } from "./learner-reservations-scenario-contract"
import type { ScreenshotReceipt } from "./learner-reservations-visual-assertions"

const reservationFixtureStates = {
  cancelled: "'cancelled_by_user'",
  completed: "'completed'",
  confirmed: "'confirmed'",
  disputed: "'disputed'",
  expired: "'pending_payment'",
  foreign: "'confirmed'",
  mismatch: "'confirmed'",
  noShow: "'no_show_user'",
  pending: "'pending_payment'",
} as const

type Sessions = Awaited<ReturnType<typeof createSessions>>
type FixtureTimes = Awaited<ReturnType<typeof seedLearnerReservationFixtures>>

export async function runLearnerReservationScenario(page: Page, testInfo: TestInfo) {
  const baseUrl = process.env["SPOLINK_AUTH_E2E_BASE_URL"]
  if (!baseUrl) throw new Error("SPOLINK_AUTH_E2E_BASE_URL is required")
  const browserDiagnostics = attachLearnerReservationBrowserDiagnostics(page, baseUrl)
  const coachEmail = testEmail(testInfo, "reservations-coach")
  const foreignLearnerEmail = testEmail(testInfo, "reservations-foreign-learner")
  const learnerEmail = testEmail(testInfo, "reservations-learner")
  let forbiddenRequestCount = 0
  const phases: PhaseReceipt[] = []
  const screenshotReceipts: ScreenshotReceipt[] = []
  const inflight = new Set<Request>()
  let cleanupCompleted = false
  let documentFinished = false
  let documentStatus: number | null = null
  let downloadReceipt: Readonly<{ bytes: number; sha256: string }> | null = null
  let headingMatched = false
  let profileMatched = false
  page.on("request", (request) => inflight.add(request))
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "document" &&
      safePathname(response.url()) === "/mypage"
    ) {
      documentStatus = response.status()
    }
  })
  page.on("requestfinished", (request) => {
    if (request.resourceType() === "document" && safePathname(request.url()) === "/mypage") {
      documentFinished = true
    }
    inflight.delete(request)
  })
  page.on("requestfailed", (request) => {
    inflight.delete(request)
  })
  try {
    await runLearnerReservationPhases<Sessions, FixtureTimes>({
      actions: {
        authSessions: () => createSessions(page, { coachEmail, foreignLearnerEmail, learnerEmail }),
        cleanup: async () => {
          await cleanupLearnerReservationFixtures()
          await cleanupLiveAuthUser(learnerEmail)
          await cleanupLiveAuthUser(foreignLearnerEmail)
          await cleanupLiveAuthUser(coachEmail)
          cleanupCompleted = true
        },
        completionRecovery: async () => {
          screenshotReceipts.push(await assertCompletionRecoverySurface({ page, testInfo }))
          await assertCompletionNotFoundRoutes(page)
          expect(forbiddenRequestCount).toBe(0)
        },
        completionSuccess: async (fixtureTimes) => {
          screenshotReceipts.push(await assertCompletionSuccessSurface({ page, testInfo }))
          await assertCompletionPersistence(page)
          downloadReceipt = await downloadCalendar(page, {
            endsAt: fixtureTimes.endsAt,
            lessonTitle: ownedLessonTitle,
            startsAt: fixtureTimes.startsAt,
          })
          await assertNonSuccessCompletionRoutes(page)
        },
        fixtureSeed: async (sessions) => {
          await cleanupLearnerReservationFixtures()
          return seedLearnerReservationFixtures({
            coachUserId: sessions.coach.userId,
            foreignLearnerUserId: sessions.foreignLearner.userId,
            learnerUserId: sessions.learner.userId,
            paymentExpiresAt: { expired: futureIso(-1), pending: futureIso(1) },
            reservationFixtureStates,
          })
        },
        learnerActivation: async (sessions) => {
          const activeCookies = await page.context().cookies()
          const learnerIsActive = sessions.learner.cookies.every((expected) =>
            activeCookies.some(
              (actual) => actual.name === expected.name && actual.value === expected.value,
            ),
          )
          expect(learnerIsActive).toBe(true)
          page.on("request", (request) => {
            if (isForbiddenReadOnlyRequest(request)) {
              forbiddenRequestCount += 1
            }
          })
        },
        myPageDocument: async () => {
          const response = await page.goto("/mypage")
          expect(response?.status()).toBe(200)
        },
        myPageReadModel: async () => {
          await assertMyPageHeading(page)
          headingMatched = true
          await assertMyPageProfile({ page, projectName: testInfo.project.name })
          profileMatched = true
        },
        reservationNavigation: () => assertReservationNavigation(page, testInfo.project.name),
      },
      runPhase: (name, action) => runReservationPhase(phases, name, action),
    })
  } finally {
    const browserDiagnosticsReceipt = browserDiagnostics.finish()
    await writeDiagnosis({
      browserDiagnostics: browserDiagnosticsReceipt,
      cleanupCompleted,
      documentFinished,
      documentStatus,
      downloadReceipt,
      forbiddenRequestCount,
      headingMatched,
      inflight,
      phases,
      profileMatched,
      screenshotReceipts,
      testInfo,
    })
  }
  assertBrowserDiagnosticsClean(browserDiagnostics.finish())
}

type SessionEmails = Readonly<{
  coachEmail: string
  foreignLearnerEmail: string
  learnerEmail: string
}>

async function createSessions(page: Page, emails: SessionEmails) {
  return {
    coach: await createLiveAuthSession(page, emails.coachEmail, testPassword),
    foreignLearner: await createLiveAuthSession(page, emails.foreignLearnerEmail, testPassword),
    learner: await createLiveAuthSession(page, emails.learnerEmail, testPassword),
  }
}

type Diagnosis = Readonly<{
  browserDiagnostics: BrowserDiagnosticsReceipt
  cleanupCompleted: boolean
  documentFinished: boolean
  documentStatus: number | null
  downloadReceipt: Readonly<{ bytes: number; sha256: string }> | null
  forbiddenRequestCount: number
  headingMatched: boolean
  inflight: ReadonlySet<Request>
  phases: readonly PhaseReceipt[]
  profileMatched: boolean
  screenshotReceipts: readonly ScreenshotReceipt[]
  testInfo: TestInfo
}>

async function writeDiagnosis(input: Diagnosis) {
  const diagnosis = {
    browserDiagnostics: input.browserDiagnostics,
    document: { finished: input.documentFinished, status: input.documentStatus },
    event: "task6-browser-diagnosis",
    cleanup: input.cleanupCompleted ? "completed" : "failed",
    download: input.downloadReceipt,
    forbiddenRequestCount: input.forbiddenRequestCount,
    headingMatched: input.headingMatched,
    inflightRequestCount: input.inflight.size,
    phases: input.phases,
    profileMatched: input.profileMatched,
    project: input.testInfo.project.name,
    screenshots: input.screenshotReceipts,
  }
  console.log(JSON.stringify(diagnosis))
  const diagnosisDir = process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"]
  if (!diagnosisDir) return
  const diagnosisPath = path.join(
    diagnosisDir,
    `task-6-browser-${input.testInfo.project.name}.json`,
  )
  await writeFile(diagnosisPath, `${JSON.stringify(diagnosis, null, 2)}\n`, { mode: 0o600 })
  await chmod(diagnosisPath, 0o600)
}

function futureIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}
