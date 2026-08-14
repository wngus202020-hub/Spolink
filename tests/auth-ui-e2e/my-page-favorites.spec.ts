import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

const fixtureIds = {
  coachProfile: "10000000-0000-4000-8000-000000000801",
  foreignFavorite: "70000000-0000-4000-8000-000000000802",
  foreignLesson: "20000000-0000-4000-8000-000000000802",
  ownedFavorite: "70000000-0000-4000-8000-000000000801",
  ownedLesson: "20000000-0000-4000-8000-000000000801",
} as const

const ownedLessonTitle = "E2E 찜한 테니스 레슨"
const foreignLessonTitle = "E2E 외부 찜 비공개 레슨"

test("unauthenticated My Page favorites route preserves safe next path", async ({ page }) => {
  await page.goto("/lessons")
  await expect(page.getByRole("link", { exact: true, name: "로그인" })).toBeVisible()
  await expect(page.getByRole("link", { exact: true, name: "마이" })).toHaveCount(0)

  await page.goto("/mypage/favorites")

  const redirectedUrl = new URL(page.url())
  expect(redirectedUrl.pathname).toBe("/auth/login")
  expect(redirectedUrl.searchParams.get("next")).toBe("/mypage/favorites")
  await expect(page.getByRole("heading", { name: "다시 운동을 시작할 시간이에요." })).toBeVisible()
})

test("profile-required users see profile setup instead of 마이", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "favorites-profile-required")

  try {
    await createLiveAuthSession(page, email, testPassword)

    await page.goto("/lessons")
    await expect(page.getByRole("link", { exact: true, name: "프로필 설정" })).toBeVisible()
    await expect(page.getByRole("link", { exact: true, name: "마이" })).toHaveCount(0)

    await page.goto("/mypage/favorites")
    await expect(page).toHaveURL(/\/onboarding\/profile$/u)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("learner with no favorites sees the empty state", async ({ page }, testInfo) => {
  const learnerEmail = testEmail(testInfo, "favorites-empty-learner")

  try {
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await createLearnerProfile(learner.userId, "찜 없음 학습자")

    await page.goto("/mypage/favorites")
    await expect(page.getByRole("heading", { level: 1, name: "찜한 레슨" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "아직 찜한 레슨이 없어요" })).toBeVisible()
    await expect(page.getByRole("link", { name: "레슨 찾기" })).toHaveAttribute("href", "/lessons")
  } finally {
    await cleanupLiveAuthUser(learnerEmail)
  }
})

test("learner navigates from 마이 to owned read-only favorites", async ({ page }, testInfo) => {
  const coachEmail = testEmail(testInfo, "favorites-coach")
  const foreignLearnerEmail = testEmail(testInfo, "favorites-foreign-learner")
  const learnerEmail = testEmail(testInfo, "favorites-learner")
  const forbiddenRequests: string[] = []

  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const foreignLearner = await createLiveAuthSession(page, foreignLearnerEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedFavoriteFixtures({
      coachUserId: coach.userId,
      foreignLearnerUserId: foreignLearner.userId,
      learnerUserId: learner.userId,
    })

    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname.includes("lesson_favorites") || /\/api\/favorites/u.test(url.pathname)) {
        forbiddenRequests.push(`${request.method()} ${request.url()}`)
      }
    })

    await page.goto("/")
    await expect(page.getByRole("link", { exact: true, name: "마이" })).toBeVisible()
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible()
    await page.getByRole("link", { exact: true, name: "마이" }).click()

    await expect(page).toHaveURL(/\/mypage$/u)
    await expect(page.getByRole("heading", { name: "마이페이지" })).toBeVisible()
    await expect(page.getByText("찜한 레슨").first()).toBeVisible()
    await expect(page.getByRole("link", { name: "내 예약 관리로 이동" })).toHaveAttribute(
      "href",
      "/mypage/reservations",
    )
    await page.getByRole("link", { name: "찜한 레슨 목록으로 이동" }).click()

    await expect(page).toHaveURL(/\/mypage\/favorites$/u)
    await expect(page.getByRole("heading", { level: 1, name: "찜한 레슨" })).toBeVisible()
    await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
    await expect(page.getByText(foreignLessonTitle)).toHaveCount(0)
    await expect(page.getByText("E2E 찜 지도자")).toBeVisible()
    await expect(page.getByText("서울 성동구 · 성동 실내 테니스 코트")).toBeVisible()
    await expect(page.getByText("33,000원")).toBeVisible()
    await expect(page.getByRole("link", { name: `${ownedLessonTitle} 상세 보기` })).toHaveAttribute(
      "href",
      `/lessons/${fixtureIds.ownedLesson}`,
    )
    await captureFavoritesScreenshot(page, testInfo.project.name, "list")

    expect(forbiddenRequests).toEqual([])
  } finally {
    await cleanupFavoriteFixtures()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(foreignLearnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

async function captureFavoritesScreenshot(
  page: import("@playwright/test").Page,
  projectName: string,
  label: string,
) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    path: path.join(visualQaDir, `my-page-favorites-${label}-${projectName}.png`),
  })
}

async function seedFavoriteFixtures({
  coachUserId,
  foreignLearnerUserId,
  learnerUserId,
}: Readonly<{
  coachUserId: string
  foreignLearnerUserId: string
  learnerUserId: string
}>) {
  await cleanupFavoriteFixtures()
  const tennisSportId = await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    return sport?.["id"]
  })
  if (typeof tennisSportId !== "string") throw new Error("Missing seeded tennis sport.")

  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${learnerUserId}, '찜 E2E 학습자', '김찜', '010-8111-1111', '서울 성동구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${foreignLearnerUserId}, '외부 찜 학습자', '이외부', '010-8222-2222', '서울 마포구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region, role, status) values (${coachUserId}, 'E2E 찜 지도자', '박지도', '010-8333-3333', '서울 성동구', 'coach', 'coach_approved')`
      await tx`insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years) values (${fixtureIds.coachProfile}, ${coachUserId}, 'approved', ${tennisSportId}, '서울 성동구', '찜한 레슨 E2E 지도자', '찜한 레슨 목록을 검증합니다.', 5)`
      await tx`insert into public.lessons (id, coach_profile_id, sport_id, status, title, summary, description, region, place_name, duration_minutes, price_amount, capacity, preparation, cancellation_policy_summary) values (${fixtureIds.ownedLesson}, ${fixtureIds.coachProfile}, ${tennisSportId}, 'active', ${ownedLessonTitle}, '찜한 레슨 E2E', '찜한 레슨 목록 화면을 검증합니다.', '서울 성동구', '성동 실내 테니스 코트', 60, 33000, 8, '운동화와 물', '24시간 이상 70% 환불'), (${fixtureIds.foreignLesson}, ${fixtureIds.coachProfile}, ${tennisSportId}, 'active', ${foreignLessonTitle}, '외부 찜 E2E', '외부 사용자의 찜이 노출되지 않는지 검증합니다.', '서울 마포구', '마포 비공개 코트', 60, 44000, 2, '운동화', '24시간 이상 70% 환불')`
      await tx`insert into public.lesson_favorites (id, learner_id, lesson_id, created_at) values (${fixtureIds.ownedFavorite}, ${learnerUserId}, ${fixtureIds.ownedLesson}, now() - interval '1 minute'), (${fixtureIds.foreignFavorite}, ${foreignLearnerUserId}, ${fixtureIds.foreignLesson}, now() - interval '2 minutes')`
    })
  })
}

async function cleanupFavoriteFixtures() {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`delete from public.lesson_favorites where id in (${fixtureIds.foreignFavorite}, ${fixtureIds.ownedFavorite})`
      await tx`delete from public.lessons where id in (${fixtureIds.foreignLesson}, ${fixtureIds.ownedLesson})`
      await tx`delete from public.coach_profiles where id = ${fixtureIds.coachProfile}`
    })
  })
}

async function createLearnerProfile(userId: string, displayName: string) {
  await withDb(async (sql) => {
    await sql`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${userId}, ${displayName}, '김학습', '010-8000-0000', '서울 성동구')`
  })
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
