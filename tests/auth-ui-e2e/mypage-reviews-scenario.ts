import { chmod, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Page, type TestInfo } from "@playwright/test"
import { testEmail, testPassword } from "./auth-form-helpers"
import { createLiveAuthSession } from "./auth-recovery-helpers"
import {
  activateReviewSession,
  assertAnonymousRedirect,
  assertOutOfRangeRecovery,
  assertOwnerAHistory,
  assertOwnerBIsolation,
  assertPublicIsolation,
  createOwnerAReviews,
  createReview,
  hideReview,
} from "./mypage-reviews-assertions"
import {
  cleanupReviewFixtures as cleanupExactFixtures,
  fixtureManifest,
  type ReviewUserIds,
  restoreAuthenticatedReviewSelect,
  seedReviewPrerequisites,
  stabilizeAndInsertDeleted,
} from "./mypage-reviews-fixtures"
import { runMypageReviewsVisualScenario } from "./mypage-reviews-visual-scenario"

type ReviewApiManifest = Readonly<{
  create: string
  hide: (reviewId: string) => string
  public: (lessonId: string) => string
}>

export function createMypageReviewsScenario(
  page: Page,
  testInfo: TestInfo,
  api: ReviewApiManifest,
) {
  const userIds: string[] = []
  const reviewIds: string[] = []
  const scenarios: string[] = []
  const visuals: object[] = []
  let grantRestored = false
  let injectedFailure = false
  let lockRelease: "not_exercised" | "released" = "not_exercised"
  let cleanup = { cleanupCounters: rejectedCounters(), verdict: "REJECT" }

  async function run(): Promise<void> {
    await assertAnonymousRedirect(page)
    scenarios.push("anonymous_redirect")
    const profileless = await createSession(page, testInfo, "profileless", userIds)
    await activateReviewSession(page, profileless)
    await page.goto("/mypage/reviews")
    await expect(page).toHaveURL(/\/onboarding\/profile$/u)
    scenarios.push("profile_required_redirect")

    const ownerA = await createSession(page, testInfo, "owner-a", userIds)
    const ownerB = await createSession(page, testInfo, "owner-b", userIds)
    const coach = await createSession(page, testInfo, "coach", userIds)
    const admin = await createSession(page, testInfo, "admin", userIds)
    const empty = await createSession(page, testInfo, "empty", userIds)
    const users: ReviewUserIds = {
      admin: admin.userId,
      coach: coach.userId,
      empty: empty.userId,
      ownerA: ownerA.userId,
      ownerB: ownerB.userId,
      profileless: profileless.userId,
    }
    await seedReviewPrerequisites(users)
    const ownerAReviewIds = await createOwnerAReviews(page, ownerA, api.create)
    reviewIds.push(...ownerAReviewIds)
    const ownerBReviewId = await createReview(
      page,
      ownerB,
      api.create,
      fixtureManifest.reservations.ownerB,
      "B 리뷰 01",
    )
    reviewIds.push(ownerBReviewId)
    await hideReview(page, admin, api.hide(ownerAReviewIds[19] ?? ""))
    await stabilizeAndInsertDeleted(reviewIds, users)
    scenarios.push("real_create_and_admin_hide")

    await assertOwnerAHistory(page, ownerA)
    scenarios.push("owner_a_history_and_pagination")
    await assertOwnerBIsolation(page, ownerB)
    scenarios.push("owner_b_isolation")
    await assertPublicIsolation(
      page,
      ownerA,
      ownerAReviewIds,
      ownerBReviewId,
      api.public(fixtureManifest.lessons.active),
    )
    scenarios.push("public_visible_only")
    await assertOutOfRangeRecovery(page, ownerA)
    scenarios.push("out_of_range_recovery")

    await runMypageReviewsVisualScenario({
      empty,
      markGrantRestored: () => {
        grantRestored = true
      },
      markInjectedFailure: () => {
        injectedFailure = true
      },
      markLockReleased: () => {
        lockRelease = "released"
      },
      onCapture: (observation) => visuals.push(observation),
      ownerA,
      page,
      testInfo,
    })
    scenarios.push("controlled_read_failure")

    if (
      process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_CHILD_FAILURE"] === "1" &&
      testInfo.project.name === "desktop-chromium"
    ) {
      injectedFailure = true
      throw new Error("Injected review child failure")
    }
  }

  async function restoreSelect(): Promise<void> {
    await restoreAuthenticatedReviewSelect()
    grantRestored = true
  }

  async function cleanupFixtures(): Promise<void> {
    try {
      cleanup = { ...(await cleanupExactFixtures(userIds, reviewIds)), verdict: "APPROVE" }
    } finally {
      await writeReceipt(testInfo, {
        cleanup,
        grantRestored,
        injectedFailure,
        lockRelease,
        scenarios,
        visuals,
      })
    }
  }

  return {
    cleanupReviewFixtures: cleanupFixtures,
    restoreAuthenticatedReviewSelect: restoreSelect,
    run,
  }
}

async function createSession(page: Page, testInfo: TestInfo, alias: string, userIds: string[]) {
  const session = await createLiveAuthSession(
    page,
    testEmail(testInfo, `mypage-reviews-${alias}`),
    testPassword,
  )
  userIds.push(session.userId)
  return session
}

async function writeReceipt(testInfo: TestInfo, value: object): Promise<void> {
  const outputDir = process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"]
  if (!outputDir) throw new Error("SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR is required.")
  const file = path.join(outputDir, `mypage-reviews-${testInfo.project.name}.json`)
  await writeFile(file, `${JSON.stringify({ ...value, project: testInfo.project.name })}\n`, {
    mode: 0o600,
  })
  await chmod(file, 0o600)
}

function rejectedCounters() {
  return {
    audits: -1,
    coaches: -1,
    lessons: -1,
    messages: -1,
    profiles: -1,
    reservations: -1,
    reviews: -1,
    schedules: -1,
    users: -1,
  }
}
