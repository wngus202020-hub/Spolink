import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import postgres from "postgres"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

const fixtureIds = {
  coachProfile: "10000000-0000-4000-8000-000000000701",
  foreignLesson: "20000000-0000-4000-8000-000000000702",
  foreignSchedule: "30000000-0000-4000-8000-000000000702",
  lesson: "20000000-0000-4000-8000-000000000701",
  schedule: "30000000-0000-4000-8000-000000000701",
} as const

const reservationIds = {
  cancelled: "40000000-0000-4000-8000-000000000705",
  completed: "40000000-0000-4000-8000-000000000704",
  confirmed: "40000000-0000-4000-8000-000000000703",
  disputed: "40000000-0000-4000-8000-000000000707",
  expired: "40000000-0000-4000-8000-000000000702",
  foreign: "40000000-0000-4000-8000-000000000708",
  noShow: "40000000-0000-4000-8000-000000000706",
  pending: "40000000-0000-4000-8000-000000000701",
} as const

const paymentIds = {
  cancelled: "50000000-0000-4000-8000-000000000705",
  completed: "50000000-0000-4000-8000-000000000704",
  confirmed: "50000000-0000-4000-8000-000000000703",
  disputed: "50000000-0000-4000-8000-000000000707",
  foreign: "50000000-0000-4000-8000-000000000708",
  noShow: "50000000-0000-4000-8000-000000000706",
} as const

const ownedLessonTitle = "E2E 학습자 예약 레슨"
const foreignLessonTitle = "E2E 외부 소유 비공개 예약"

test("unauthenticated My Page reservation routes preserve safe next paths", async ({ page }) => {
  for (const route of [
    "/mypage",
    "/mypage/reservations",
    `/mypage/reservations/${reservationIds.foreign}`,
  ]) {
    await page.goto(route)
    const redirectedUrl = new URL(page.url())
    expect(redirectedUrl.pathname).toBe("/auth/login")
    expect(redirectedUrl.searchParams.get("next")).toBe(route)
    await expect(
      page.getByRole("heading", { name: "다시 운동을 시작할 시간이에요." }),
    ).toBeVisible()
  }
})

test("learner views owned reservation filters and guarded details without mutations", async ({
  page,
}, testInfo) => {
  const coachEmail = testEmail(testInfo, "reservations-coach")
  const foreignLearnerEmail = testEmail(testInfo, "reservations-foreign-learner")
  const learnerEmail = testEmail(testInfo, "reservations-learner")
  const forbiddenRequests: string[] = []

  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const foreignLearner = await createLiveAuthSession(page, foreignLearnerEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedLearnerReservationFixtures({
      coachUserId: coach.userId,
      foreignLearnerUserId: foreignLearner.userId,
      learnerUserId: learner.userId,
    })

    page.on("request", (request) => {
      const url = new URL(request.url())
      if (
        /^\/api\/reservations\/[^/]+\/cancel$/u.test(url.pathname) ||
        url.pathname === "/api/payments/confirm" ||
        url.pathname === "/api/payments/prepare" ||
        url.hostname.toLowerCase().includes("toss")
      ) {
        forbiddenRequests.push(request.url())
      }
    })

    await page.goto("/mypage")
    await expect(page.getByRole("heading", { name: "마이페이지" })).toBeVisible()
    await expect(page.getByText("예약 E2E 학습자").first()).toBeVisible()
    await captureReservationScreenshot(page, testInfo.project.name, "hub")
    await page.getByRole("link", { name: "예약 보기" }).click()

    await expect(page).toHaveURL(/\/mypage\/reservations$/u)
    await expect(page.getByRole("heading", { name: "내 예약" })).toBeVisible()
    await expect(page.locator("article")).toHaveCount(7)
    await expect(page.getByText(foreignLessonTitle)).toHaveCount(0)
    for (const status of [
      "결제 대기",
      "예약 확정",
      "수업 완료",
      "학습자 취소",
      "학습자 노쇼",
      "분쟁 중",
    ]) {
      await expect(page.getByText(status).first()).toBeVisible()
    }
    await captureReservationScreenshot(page, testInfo.project.name, "list-all")

    await assertFilter(page, "결제 대기", "pending", 2, "결제 대기")
    const continueLink = page.getByRole("link", { name: "결제 계속" })
    await expect(continueLink).toHaveCount(1)
    await expect(continueLink).toHaveAttribute(
      "href",
      `/reservations/${reservationIds.pending}/payment`,
    )
    await continueLink.click()
    await expect(page).toHaveURL(`/reservations/${reservationIds.pending}/payment`)
    await expect(page.getByRole("heading", { name: "결제 요청 정보를 준비해요" })).toBeVisible()

    await page.goto(`/mypage/reservations/${reservationIds.expired}`)
    await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
    await expect(page.getByRole("link", { name: "결제 계속" })).toHaveCount(0)
    await expect(page.getByText("현재 상태에서는 결제를 계속할 수 없어요.")).toBeVisible()

    await page.goto(`/mypage/reservations/${reservationIds.confirmed}`)
    await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
    await expect(page.getByText("현재 예약 상태는 취소 요청 대상이에요.")).toBeVisible()
    await expect(page.getByText("현재 시각 기준 예상 환불액 7,000원")).toBeVisible()
    await expect(page.getByText(/수업 시작 24시간 이상 전/u)).toBeVisible()
    await expect(page.getByText(/수업 시작 3시간 이상 24시간 미만/u)).toBeVisible()
    await expect(page.getByText("이 화면에서는 취소 요청을 제출할 수 없어요.")).toBeVisible()
    await expect(page.getByRole("button", { name: /취소/u })).toHaveCount(0)
    await captureReservationScreenshot(page, testInfo.project.name, "detail-confirmed")

    await page.goto("/mypage/reservations")
    await assertFilter(page, "예약 확정", "confirmed", 1, "예약 확정")
    await assertFilter(page, "완료", "completed", 1, "수업 완료")
    await assertFilter(page, "취소", "cancelled", 1, "학습자 취소")
    await assertFilter(page, "노쇼", "no_show", 1, "학습자 노쇼")
    await assertFilter(page, "분쟁", "disputed", 1, "분쟁 중")

    const foreignResponse = await page.goto(`/mypage/reservations/${reservationIds.foreign}`)
    expect(foreignResponse?.status()).toBe(404)
    await expect(page.getByText(foreignLessonTitle)).toHaveCount(0)
    await expect(page.getByText("외부 예약 학습자")).toHaveCount(0)

    expect(forbiddenRequests).toEqual([])
  } finally {
    await cleanupLearnerReservationFixtures()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(foreignLearnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

async function assertFilter(
  page: Page,
  linkName: string,
  status: string,
  expectedRows: number,
  expectedStatus: string,
) {
  await page.getByRole("link", { exact: true, name: linkName }).click()
  await expect(page).toHaveURL(new RegExp(`/mypage/reservations\\?status=${status}$`, "u"))
  await expect(page.locator("article")).toHaveCount(expectedRows)
  await expect(page.getByText(expectedStatus).first()).toBeVisible()
}

async function captureReservationScreenshot(page: Page, projectName: string, label: string) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    path: path.join(visualQaDir, `learner-reservations-${label}-${projectName}.png`),
  })
}

async function seedLearnerReservationFixtures({
  coachUserId,
  foreignLearnerUserId,
  learnerUserId,
}: Readonly<{
  coachUserId: string
  foreignLearnerUserId: string
  learnerUserId: string
}>) {
  await cleanupLearnerReservationFixtures()
  const tennisSportId = await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    return sport?.["id"]
  })
  if (typeof tennisSportId !== "string") throw new Error("Missing seeded tennis sport.")

  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${learnerUserId}, '예약 E2E 학습자', '김예약', '010-1111-1111', '서울 성동구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${foreignLearnerUserId}, '외부 예약 학습자', '이외부', '010-2222-2222', '서울 마포구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region, role, status) values (${coachUserId}, '예약 E2E 지도자', '박지도', '010-3333-3333', '서울 성동구', 'coach', 'coach_approved')`
      await tx`insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years) values (${fixtureIds.coachProfile}, ${coachUserId}, 'approved', ${tennisSportId}, '서울 성동구', '학습자 예약 E2E 지도자', '학습자 예약 목록과 상세를 검증합니다.', 5)`
      await tx`insert into public.lessons (id, coach_profile_id, sport_id, status, title, summary, description, region, place_name, duration_minutes, price_amount, capacity, preparation, cancellation_policy_summary) values (${fixtureIds.lesson}, ${fixtureIds.coachProfile}, ${tennisSportId}, 'active', ${ownedLessonTitle}, '학습자 예약 E2E 레슨', '학습자 예약 목록과 상세 화면을 검증합니다.', '서울 성동구', '성동 실내 테니스 코트', 60, 10001, 10, '운동화와 물', '24시간 이상 70%, 3시간 이상 24시간 미만 50%, 3시간 미만 환불 불가'), (${fixtureIds.foreignLesson}, ${fixtureIds.coachProfile}, ${tennisSportId}, 'active', ${foreignLessonTitle}, '외부 소유 예약 E2E 레슨', '외부 소유 예약 정보가 노출되지 않는지 검증합니다.', '서울 마포구', '마포 비공개 코트', 60, 20000, 2, '운동화', '24시간 이상 70% 환불')`
      await tx`insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open) values (${fixtureIds.schedule}, ${fixtureIds.lesson}, ${futureIso(25)}, ${futureIso(26)}, 10, 1, true), (${fixtureIds.foreignSchedule}, ${fixtureIds.foreignLesson}, ${futureIso(30)}, ${futureIso(31)}, 2, 1, true)`
      await tx`insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount, payment_expires_at, confirmed_at, completed_at, cancelled_at, no_show_marked_at, dispute_reason, created_at) values (${reservationIds.pending}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'pending_payment', 10001, ${futureIso(1)}, null, null, null, null, null, now() - interval '1 minute'), (${reservationIds.expired}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'pending_payment', 10001, ${futureIso(-1)}, null, null, null, null, null, now() - interval '2 minutes'), (${reservationIds.confirmed}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'confirmed', 10001, null, now(), null, null, null, null, now() - interval '3 minutes'), (${reservationIds.completed}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'completed', 10001, null, now() - interval '2 days', now() - interval '1 day', null, null, null, now() - interval '4 minutes'), (${reservationIds.cancelled}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'cancelled_by_user', 10001, null, now() - interval '2 days', null, now() - interval '1 day', null, null, now() - interval '5 minutes'), (${reservationIds.noShow}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'no_show_user', 10001, null, now() - interval '2 days', null, null, now() - interval '1 day', null, now() - interval '6 minutes'), (${reservationIds.disputed}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, 'disputed', 10001, null, now() - interval '2 days', null, null, null, '수업 진행 확인 중', now() - interval '7 minutes'), (${reservationIds.foreign}, ${fixtureIds.foreignLesson}, ${fixtureIds.foreignSchedule}, ${foreignLearnerUserId}, ${fixtureIds.coachProfile}, 'confirmed', 20000, null, now(), null, null, null, null, now() - interval '8 minutes')`
      await tx`insert into public.payments (id, reservation_id, payer_id, status, provider, provider_order_id, amount, approved_at) values (${paymentIds.confirmed}, ${reservationIds.confirmed}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.confirmed}`}, 10001, now()), (${paymentIds.completed}, ${reservationIds.completed}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.completed}`}, 10001, now() - interval '2 days'), (${paymentIds.cancelled}, ${reservationIds.cancelled}, ${learnerUserId}, 'refunded', 'toss', ${`e2e_${reservationIds.cancelled}`}, 10001, now() - interval '2 days'), (${paymentIds.noShow}, ${reservationIds.noShow}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.noShow}`}, 10001, now() - interval '2 days'), (${paymentIds.disputed}, ${reservationIds.disputed}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.disputed}`}, 10001, now() - interval '2 days'), (${paymentIds.foreign}, ${reservationIds.foreign}, ${foreignLearnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.foreign}`}, 20000, now())`
      await tx`insert into public.refunds (id, payment_id, reservation_id, requested_by, amount, reason, source, status, processed_at) values ('60000000-0000-4000-8000-000000000705', ${paymentIds.cancelled}, ${reservationIds.cancelled}, ${learnerUserId}, 7000, '학습자 취소 환불', 'reservation_cancellation', 'completed', now())`
    })
  })
}

async function cleanupLearnerReservationFixtures() {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`delete from public.refunds where reservation_id in (${reservationIds.cancelled}, ${reservationIds.completed}, ${reservationIds.confirmed}, ${reservationIds.disputed}, ${reservationIds.expired}, ${reservationIds.foreign}, ${reservationIds.noShow}, ${reservationIds.pending})`
      await tx`delete from public.payments where reservation_id in (${reservationIds.cancelled}, ${reservationIds.completed}, ${reservationIds.confirmed}, ${reservationIds.disputed}, ${reservationIds.expired}, ${reservationIds.foreign}, ${reservationIds.noShow}, ${reservationIds.pending})`
      await tx`delete from public.reservations where id in (${reservationIds.cancelled}, ${reservationIds.completed}, ${reservationIds.confirmed}, ${reservationIds.disputed}, ${reservationIds.expired}, ${reservationIds.foreign}, ${reservationIds.noShow}, ${reservationIds.pending})`
      await tx`delete from public.lesson_schedules where id in (${fixtureIds.foreignSchedule}, ${fixtureIds.schedule})`
      await tx`delete from public.lessons where id in (${fixtureIds.foreignLesson}, ${fixtureIds.lesson})`
      await tx`delete from public.coach_profiles where id = ${fixtureIds.coachProfile}`
    })
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
