import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import postgres from "postgres"
import { fixedIds } from "../supabase-e2e/fixtures.mjs"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

const learnerProfile = {
  defaultRegion: "서울 강남구",
  displayName: "예약 학습자",
  phone: "010-1234-5678",
  realName: "김예약",
}
const coachProfile = {
  defaultRegion: "서울 성동구",
  displayName: "예약 지도자",
  phone: "010-9876-5432",
  realName: "박지도",
}

test("demo booking blocks reservation mutation before API submission", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "demo-booking-guard")
  let reservationRequests = 0
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await createProfileForUser(session.userId, learnerProfile)
    await page.route("**/api/reservations", async (route) => {
      reservationRequests += 1
      await route.fulfill({ json: { error: { code: "UNEXPECTED" } }, status: 500 })
    })

    await page.goto("/lessons/tennis-gangnam/booking?scheduleId=tennis-gangnam-today")
    await captureBookingScreenshot(page, testInfo.project.name, "demo")
    await page.getByRole("button", { name: "예약 요청" }).click()

    await expect(page.locator("form").getByRole("alert")).toContainText(
      "데모 레슨은 실제 예약을 만들 수 없어요",
    )
    await expect(page.locator("form").getByRole("alert")).toBeFocused()
    expect(reservationRequests).toBe(0)
    await expect(page).toHaveURL(/\/lessons\/tennis-gangnam\/booking/)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("unavailable booking schedule shows recovery without mutation", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "unavailable-booking-schedule")
  let reservationRequests = 0
  try {
    const session = await createLiveAuthSession(page, email, testPassword)
    await createProfileForUser(session.userId, learnerProfile)
    await page.route("**/api/reservations", async (route) => {
      reservationRequests += 1
      await route.fulfill({ json: { error: { code: "UNEXPECTED" } }, status: 500 })
    })

    await page.goto("/lessons/tennis-gangnam/booking?scheduleId=tennis-gangnam-closed")
    await expect(
      page.getByRole("heading", { name: "예약 가능한 일정을 다시 선택해요" }),
    ).toBeVisible()
    await expect(page.getByRole("link", { name: "다른 일정 선택" })).toHaveAttribute(
      "href",
      "/lessons/tennis-gangnam",
    )
    await expect(page.getByRole("button", { name: "예약 요청" })).toHaveCount(0)
    expect(reservationRequests).toBe(0)

    await page.goto("/lessons/tennis-gangnam/booking?scheduleId=missing-schedule")
    await expect(
      page.getByRole("heading", { name: "예약 가능한 일정을 다시 선택해요" }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "예약 요청" })).toHaveCount(0)
    expect(reservationRequests).toBe(0)
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("uuid booking posts one pending reservation and hands off to payment", async ({
  page,
}, testInfo) => {
  const learnerEmail = testEmail(testInfo, "uuid-booking-learner")
  const coachEmail = testEmail(testInfo, "uuid-booking-coach")
  const requests: unknown[] = []
  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedUuidLesson({ coachUserId: coach.userId, learnerUserId: learner.userId })
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/reservations") {
        requests.push(request.postDataJSON())
      }
    })
    await page.route("**/api/payments/prepare", async (route) => {
      throw new Error(`Booking confirmation must not call ${route.request().url()}`)
    })

    await page.goto(
      `/lessons/${fixedIds.lesson}/booking?scheduleId=${fixedIds.baselineOpenSchedule}`,
    )
    await expect(page.getByRole("heading", { name: "예약 정보를 확인해요" })).toBeVisible()
    await expect(page.getByText("24시간 이상 70% 환불")).toBeVisible()
    await captureBookingScreenshot(page, testInfo.project.name, "uuid")
    await submitBookingTwice(page)

    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}\/payment$/)
    await expect(page.getByRole("heading", { name: "결제 요청 정보를 준비해요" })).toBeVisible()
    await expect(page.getByText("결제 준비 전")).toBeVisible()
    await expect(page.getByRole("button", { name: "결제 요청 준비" })).toBeVisible()
    await captureBookingScreenshot(page, testInfo.project.name, "payment")
    expect(requests).toEqual([
      { lessonId: fixedIds.lesson, lessonScheduleId: fixedIds.baselineOpenSchedule },
    ])
  } finally {
    await cleanupUuidLesson()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

test("uuid booking capacity error focuses recovery and allows retry", async ({
  page,
}, testInfo) => {
  const learnerEmail = testEmail(testInfo, "uuid-booking-retry-learner")
  const coachEmail = testEmail(testInfo, "uuid-booking-retry-coach")
  let requests = 0
  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedUuidLesson({ coachUserId: coach.userId, learnerUserId: learner.userId })
    await page.route("**/api/reservations", async (route) => {
      requests += 1
      if (requests === 1) {
        await route.fulfill({
          json: {
            error: {
              code: "CAPACITY_EXCEEDED",
              details: [],
              message: "No remaining capacity.",
            },
          },
          status: 409,
        })
        return
      }

      await route.fallback()
    })
    await page.route("**/api/payments/prepare", async (route) => {
      throw new Error(`Booking confirmation must not call ${route.request().url()}`)
    })

    await page.goto(
      `/lessons/${fixedIds.lesson}/booking?scheduleId=${fixedIds.baselineOpenSchedule}`,
    )
    await page.getByRole("button", { name: "예약 요청" }).click()
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "선택한 일정의 예약 가능 인원이 없어요",
    )
    await expect(page.locator("form").getByRole("alert")).toBeFocused()

    await page.getByRole("button", { name: "예약 요청" }).click()
    await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}\/payment$/)
    await expect(page.getByRole("heading", { name: "결제 요청 정보를 준비해요" })).toBeVisible()
    await expect(page.getByRole("button", { name: "결제 요청 준비" })).toBeVisible()
    await captureBookingScreenshot(page, testInfo.project.name, "payment-retry")
    expect(requests).toBe(2)
  } finally {
    await cleanupUuidLesson()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

async function submitBookingTwice(page: Page) {
  await page
    .locator("form", { has: page.getByRole("button", { name: "예약 요청" }) })
    .evaluate((form) => {
      if (!(form instanceof HTMLFormElement)) throw new Error("Booking form is unavailable.")
      form.requestSubmit()
      form.requestSubmit()
    })
}

async function captureBookingScreenshot(page: Page, projectName: string, label: string) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    path: path.join(visualQaDir, `booking-confirmation-${label}-${projectName}.png`),
  })
}

async function seedUuidLesson({
  coachUserId,
  learnerUserId,
}: Readonly<{ coachUserId: string; learnerUserId: string }>) {
  await cleanupUuidLesson()
  const tennisSportId = await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    return sport?.["id"]
  })
  if (typeof tennisSportId !== "string") throw new Error("Missing seeded tennis sport.")

  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${learnerUserId}, ${learnerProfile.displayName}, ${learnerProfile.realName}, ${learnerProfile.phone}, ${learnerProfile.defaultRegion})`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region, role, status) values (${coachUserId}, ${coachProfile.displayName}, ${coachProfile.realName}, ${coachProfile.phone}, ${coachProfile.defaultRegion}, 'coach', 'coach_approved')`
      await tx`insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years) values (${fixedIds.approvedCoachProfile}, ${coachUserId}, 'approved', ${tennisSportId}, '서울 성동구', '초보 테니스 전문 코치', '예약 확인 E2E 지도자입니다.', 4)`
      await tx`insert into public.lessons (id, coach_profile_id, sport_id, status, title, summary, description, region, place_name, duration_minutes, price_amount, capacity, preparation, cancellation_policy_summary) values (${fixedIds.lesson}, ${fixedIds.approvedCoachProfile}, ${tennisSportId}, 'active', 'E2E Tennis Lesson', '예약 확인 화면용 로컬 레슨', '예약 확인 화면용 로컬 레슨입니다.', '서울 성동구', '성동 실내 테니스 코트', 60, 10001, 2, '운동화와 물', '24시간 이상 70%, 3시간 이상 24시간 미만 50%, 3시간 미만 환불 불가')`
      await tx`insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open) values (${fixedIds.baselineOpenSchedule}, ${fixedIds.lesson}, ${futureIso(25)}, ${futureIso(26)}, 2, 0, true)`
    })
  })
}

async function cleanupUuidLesson() {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`delete from public.reservations where lesson_id = ${fixedIds.lesson}`
      await tx`delete from public.lesson_schedules where lesson_id = ${fixedIds.lesson}`
      await tx`delete from public.lessons where id = ${fixedIds.lesson}`
      await tx`delete from public.coach_profiles where id = ${fixedIds.approvedCoachProfile}`
    })
  })
}

async function createProfileForUser(userId: string, profile: typeof learnerProfile) {
  await withDb(async (sql) => {
    await sql`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${userId}, ${profile.displayName}, ${profile.realName}, ${profile.phone}, ${profile.defaultRegion})`
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

function futureIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}
