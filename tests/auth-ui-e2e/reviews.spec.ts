import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

const ids = {
  coach: "74000000-0000-4000-8000-000000000001",
  lesson: "74000000-0000-4000-8000-000000000002",
  reservation: "74000000-0000-4000-8000-000000000003",
  schedule: "74000000-0000-4000-8000-000000000004",
}

test("learner writes one review and public lesson reads visible review", async ({ page }) => {
  const coachEmail = testEmail(test.info(), "reviews-coach")
  const email = testEmail(test.info(), "reviews-learner")
  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const session = await createLiveAuthSession(page, email, testPassword)
    await seed(coach.userId, session.userId)
    await page.goto(`/mypage/reviews/new?reservationId=${ids.reservation}`)
    await expect(page.getByRole("heading", { name: "수업 후기 남기기" })).toBeVisible()
    await expect(page.getByRole("button", { name: "5점" })).toBeVisible()
    await page.getByLabel("수업 후기").fill("설명이 명확하고 집중하기 좋았어요.")
    const response = page.waitForResponse(
      (item) => item.url().endsWith("/api/reviews") && item.request().method() === "POST",
    )
    await page.getByRole("button", { name: "후기 등록" }).click()
    const reviewResponse = await response
    expect(reviewResponse.status()).toBe(201)
    await expect(page.getByRole("status")).toContainText("후기를 등록했어요")
    const publicResponse = await page.request.get(`/api/lessons/${ids.lesson}/reviews`)
    expect(publicResponse.status()).toBe(200)
    expect((await publicResponse.json()).data).toHaveLength(1)
  } finally {
    await cleanupReview()
    await cleanupLiveAuthUser(email)
    await cleanupLiveAuthUser(coachEmail)
  }
})

async function seed(coachUserId: string, learnerId: string) {
  await cleanupReview()
  await withDb(async (sql) => {
    const sport = await sql`select id from public.sports where slug = 'tennis' limit 1`
    const sportId = sport[0]?.["id"]
    if (typeof sportId !== "string") throw new Error("Missing tennis sport fixture.")
    await sql`insert into public.profiles (id, display_name, role, status) values (${learnerId}, 'Review browser learner', 'learner', 'active'), (${coachUserId}, 'Review browser coach', 'coach', 'coach_approved')`
    await sql`insert into public.coach_profiles (id, user_id, status, service_region) values (${ids.coach}, ${coachUserId}, 'approved', '서울')`
    await sql`insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity) values (${ids.lesson}, ${ids.coach}, ${sportId}, 'active', 'Review browser lesson', '완료 수업 후기 테스트', '서울', 60, 10000, 2)`
    await sql`insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count) values (${ids.schedule}, ${ids.lesson}, now() + interval '1 day', now() + interval '1 day 1 hour', 2, 1)`
    await sql`insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount) values (${ids.reservation}, ${ids.lesson}, ${ids.schedule}, ${learnerId}, ${ids.coach}, 'completed', 10000)`
  })
}

async function cleanupReview() {
  await withDb(async (sql) => {
    await sql`delete from public.reviews where reservation_id = ${ids.reservation}`
    await sql`delete from public.reservations where id = ${ids.reservation}`
    await sql`delete from public.lesson_schedules where id = ${ids.schedule}`
    await sql`delete from public.lessons where id = ${ids.lesson}`
    await sql`delete from public.coach_profiles where id = ${ids.coach}`
  })
}

async function withDb(run: (sql: postgres.Sql) => Promise<void>) {
  const url = process.env["SPOLINK_AUTH_E2E_DB_URL"]
  if (!url) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")
  const sql = postgres(url, { idle_timeout: 1, max: 1 })
  try {
    await run(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}
