import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"

import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

const fixtureIds = {
  activeLesson: "91000000-0000-4000-8000-000000000001",
  coachProfile: "92000000-0000-4000-8000-000000000001",
  pausedLesson: "91000000-0000-4000-8000-000000000002",
}

test("learner removes, restores, races, and reloads a favorite through the live boundary", async ({
  page,
  request,
}, testInfo) => {
  const coachEmail = testEmail(testInfo, "favorites-coach")
  const learnerEmail = testEmail(testInfo, "favorites-learner")

  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedFavorites(coach.userId, learner.userId)

    await page.goto("/mypage/favorites")
    await expect(page.getByRole("heading", { name: "찜한 레슨" })).toBeVisible()
    await expect(page.getByText("Favorite browser lesson")).toBeVisible()
    await captureScreenshot(page, testInfo.project.name, "initial")

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/favorites") && response.request().method() === "DELETE",
    )
    const scrollBeforeDelete = await page.evaluate(() => window.scrollY)
    await page.getByRole("button", { name: "찜 삭제" }).click()
    expect((await deleteResponse).status()).toBe(200)
    await expect(page.getByRole("status")).toContainText("찜을 삭제했어요")
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeDelete)
    await expect(page.getByText("Favorite browser lesson")).toHaveCount(0)
    expect(await favoriteCount(learner.userId)).toBe(0)
    await captureScreenshot(page, testInfo.project.name, "removed")

    const restoreResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/favorites") && response.request().method() === "POST",
    )
    const scrollBeforeRestore = await page.evaluate(() => window.scrollY)
    await page.getByRole("button", { name: "다시 찜하기" }).click()
    expect((await restoreResponse).status()).toBe(201)
    await expect(page.getByRole("status")).toContainText("찜을 다시 저장했어요")
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeRestore)
    expect(await favoriteCount(learner.userId)).toBe(1)
    await captureScreenshot(page, testInfo.project.name, "restored")

    await page.getByRole("button", { name: "찜 삭제" }).click()
    await expect(page.getByRole("status")).toContainText("찜을 삭제했어요")
    const race = await page.evaluate(async (lessonId) => {
      return Promise.all(
        Array.from({ length: 6 }, async () => {
          const response = await fetch("/api/favorites", {
            body: JSON.stringify({ lessonId }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          })
          return { cacheControl: response.headers.get("cache-control"), status: response.status }
        }),
      )
    }, fixtureIds.activeLesson)
    expect(race.map((result) => result.status).sort()).toEqual([200, 200, 200, 200, 200, 201])
    expect(race.every((result) => result.cacheControl === "private, no-store")).toBe(true)
    expect(await favoriteCount(learner.userId)).toBe(1)

    await page.reload()
    await expect(page.getByText("Favorite browser lesson")).toBeVisible()

    const adversarial = await Promise.all([
      page.request.post("/api/favorites", {
        data: "not-json",
        headers: { "Content-Type": "text/plain", Origin: "https://foreign.test" },
      }),
      page.request.post("/api/favorites", {
        data: "not-json",
        headers: { "Content-Type": "text/plain", Origin: new URL(page.url()).origin },
      }),
      page.request.post("/api/favorites", {
        data: "not-json",
        headers: { "Content-Type": "application/json", Origin: new URL(page.url()).origin },
      }),
      page.request.post("/api/favorites", {
        data: { lessonId: "malformed" },
        headers: { Origin: new URL(page.url()).origin },
      }),
      page.request.post("/api/favorites", {
        data: { lessonId: fixtureIds.pausedLesson },
        headers: { Origin: new URL(page.url()).origin },
      }),
      request.post("/api/favorites", {
        data: { lessonId: fixtureIds.activeLesson },
        headers: { Origin: new URL(page.url()).origin },
      }),
    ])
    expect(adversarial.map((response) => response.status())).toEqual([403, 415, 422, 422, 409, 401])
    expect(
      adversarial.every((response) => response.headers()["cache-control"] === "private, no-store"),
    ).toBe(true)
    expect(await favoriteCount(learner.userId)).toBe(1)
  } finally {
    await cleanupFavorites()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

async function seedFavorites(coachUserId: string, learnerUserId: string) {
  await cleanupFavorites()
  await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    const sportId = sport?.["id"]
    if (typeof sportId !== "string") throw new Error("Missing tennis sport fixture.")

    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, role, status) values (${learnerUserId}, 'Favorite browser learner', 'learner', 'active'), (${coachUserId}, 'Favorite browser coach', 'coach', 'coach_approved')`
      await tx`insert into public.coach_profiles (id, user_id, status, service_region) values (${fixtureIds.coachProfile}, ${coachUserId}, 'approved', '서울')`
      await tx`insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity) values (${fixtureIds.activeLesson}, ${fixtureIds.coachProfile}, ${sportId}, 'active', 'Favorite browser lesson', 'Favorite browser active fixture', '서울', 60, 12000, 4), (${fixtureIds.pausedLesson}, ${fixtureIds.coachProfile}, ${sportId}, 'paused', 'Favorite paused lesson', 'Favorite browser paused fixture', '서울', 60, 12000, 4)`
      await tx`insert into public.lesson_favorites (learner_id, lesson_id) values (${learnerUserId}, ${fixtureIds.activeLesson})`
    })
  })
}

async function favoriteCount(learnerUserId: string) {
  return withDb(async (sql) => {
    const [row] =
      await sql`select count(*)::integer as count from public.lesson_favorites where learner_id = ${learnerUserId}`
    return row?.["count"]
  })
}

async function cleanupFavorites() {
  await withDb(async (sql) => {
    await sql`delete from public.lesson_favorites where lesson_id in (${fixtureIds.activeLesson}, ${fixtureIds.pausedLesson})`
    await sql`delete from public.lessons where id in (${fixtureIds.activeLesson}, ${fixtureIds.pausedLesson})`
    await sql`delete from public.coach_profiles where id = ${fixtureIds.coachProfile}`
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

async function captureScreenshot(
  page: import("@playwright/test").Page,
  project: string,
  state: string,
) {
  const directory = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!directory) return
  const scrollPosition = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
  try {
    await page.evaluate(() => {
      const root = document.documentElement
      const scrollBehavior = root.style.scrollBehavior
      root.style.scrollBehavior = "auto"
      window.scrollTo(0, 0)
      root.style.scrollBehavior = scrollBehavior
    })
    await page.screenshot({
      fullPage: project === "mobile-chromium",
      path: path.join(directory, `${project}-${state}.png`),
    })
  } finally {
    await page.evaluate((position) => {
      const root = document.documentElement
      const scrollBehavior = root.style.scrollBehavior
      root.style.scrollBehavior = "auto"
      window.scrollTo(position.x, position.y)
      root.style.scrollBehavior = scrollBehavior
    }, scrollPosition)
  }
}
