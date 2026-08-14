import path from "node:path"
import { expect, type Page, test } from "@playwright/test"
import postgres from "postgres"
import { fixedIds } from "../supabase-e2e/fixtures.mjs"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"

const reservationIds = {
  cancelled: "00000000-0000-4000-8000-000000000454",
  confirmed: "00000000-0000-4000-8000-000000000453",
  expired: "00000000-0000-4000-8000-000000000452",
  pending: "00000000-0000-4000-8000-000000000451",
  unavailable: "00000000-0000-4000-8000-000000000455",
} as const
const unavailablePaymentId = "00000000-0000-4000-8000-000000000555"

test("unauthenticated payment page preserves the requested next path", async ({ page }) => {
  await page.goto(`/reservations/${reservationIds.pending}/payment`)

  await expect(page).toHaveURL(
    new RegExp(`/auth/login\\?next=/reservations/${reservationIds.pending}/payment`),
  )
  await expect(page.getByRole("heading", { name: "다시 운동을 시작할 시간이에요." })).toBeVisible()
})

test("pending payment prepares exactly once without checkout or confirmation", async ({
  page,
}, testInfo) => {
  const learnerEmail = testEmail(testInfo, "payment-learner")
  const coachEmail = testEmail(testInfo, "payment-coach")
  const prepareBodies: unknown[] = []
  const forbiddenRequests: string[] = []

  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedPaymentFixtures({ coachUserId: coach.userId, learnerUserId: learner.userId })

    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname === "/api/payments/prepare") prepareBodies.push(request.postDataJSON())
      if (url.pathname === "/api/payments/confirm" || url.hostname.includes("toss")) {
        forbiddenRequests.push(request.url())
      }
    })

    await page.goto(`/reservations/${reservationIds.pending}/payment`)
    await expect(page.getByRole("heading", { name: "결제 요청 정보를 준비해요" })).toBeVisible()
    await expect(page.getByText("결제 준비 전")).toBeVisible()
    await expect(page.getByText("10,001원").first()).toBeVisible()
    await expect(page.getByRole("button", { name: "결제 요청 준비" })).toBeVisible()
    await expect(page.getByText("결제 처리가 끝난 예약이에요")).toHaveCount(0)
    await expect(page.getByText("결제 완료")).toHaveCount(0)
    await capturePaymentScreenshot(page, testInfo.project.name, "pending")

    await submitPaymentPreparationTwice(page)

    await expect(page.getByText("결제 요청 준비됨")).toBeVisible()
    await expect(page.getByRole("button", { name: "준비 정보 다시 확인" })).toBeVisible()
    expect(prepareBodies).toEqual([{ reservationId: reservationIds.pending }])
    expect(forbiddenRequests).toEqual([])
    await expectReadyPaymentCount(reservationIds.pending, 1)
    await capturePaymentScreenshot(page, testInfo.project.name, "prepared")

    await page.reload()
    await expect(page.getByRole("heading", { name: "준비된 결제 요청을 확인해요" })).toBeVisible()
    await expect(page.getByText("결제 요청 준비됨")).toBeVisible()
    await expect(page.getByRole("button", { name: "준비 정보 다시 확인" })).toBeVisible()
    expect(prepareBodies).toHaveLength(1)
    expect(forbiddenRequests).toEqual([])
    await capturePaymentScreenshot(page, testInfo.project.name, "ready")
  } finally {
    await cleanupPaymentFixtures()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

test("expired and unavailable reservation states never offer preparation", async ({
  page,
}, testInfo) => {
  const learnerEmail = testEmail(testInfo, "payment-states-learner")
  const coachEmail = testEmail(testInfo, "payment-states-coach")
  let prepareRequests = 0

  try {
    const coach = await createLiveAuthSession(page, coachEmail, testPassword)
    const learner = await createLiveAuthSession(page, learnerEmail, testPassword)
    await seedPaymentFixtures({ coachUserId: coach.userId, learnerUserId: learner.userId })
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/payments/prepare") prepareRequests += 1
    })

    for (const scenario of [
      { id: reservationIds.expired, title: "결제 준비 시간이 지났어요" },
      { id: reservationIds.confirmed, title: "결제 처리가 끝난 예약이에요" },
      { id: reservationIds.cancelled, title: "결제를 준비할 수 없는 예약이에요" },
      { id: reservationIds.unavailable, title: "지금은 결제를 준비할 수 없어요" },
    ]) {
      await page.goto(`/reservations/${scenario.id}/payment`)
      await expect(page.getByRole("heading", { name: scenario.title })).toBeVisible()
      await expect(
        page.getByRole("button", { name: /결제 요청 준비|준비 정보 다시 확인/ }),
      ).toHaveCount(0)
      await expect(page.getByText("현재 상태에서는 결제 요청을 준비할 수 없어요.")).toBeVisible()
    }

    expect(prepareRequests).toBe(0)
  } finally {
    await cleanupPaymentFixtures()
    await cleanupLiveAuthUser(learnerEmail)
    await cleanupLiveAuthUser(coachEmail)
  }
})

async function submitPaymentPreparationTwice(page: Page) {
  await page
    .locator("form", { has: page.getByRole("button", { name: "결제 요청 준비" }) })
    .evaluate((form) => {
      if (!(form instanceof HTMLFormElement))
        throw new Error("Payment preparation form is unavailable.")
      form.requestSubmit()
      form.requestSubmit()
    })
}

async function capturePaymentScreenshot(page: Page, projectName: string, label: string) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    path: path.join(visualQaDir, `payment-preparation-${label}-${projectName}.png`),
  })
}

async function seedPaymentFixtures({
  coachUserId,
  learnerUserId,
}: Readonly<{ coachUserId: string; learnerUserId: string }>) {
  await cleanupPaymentFixtures()
  const tennisSportId = await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    return sport?.["id"]
  })
  if (typeof tennisSportId !== "string") throw new Error("Missing seeded tennis sport.")

  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${learnerUserId}, '결제 학습자', '김결제', '010-1234-5678', '서울 강남구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region, role, status) values (${coachUserId}, '결제 지도자', '박지도', '010-9876-5432', '서울 성동구', 'coach', 'coach_approved')`
      await tx`insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years) values (${fixedIds.approvedCoachProfile}, ${coachUserId}, 'approved', ${tennisSportId}, '서울 성동구', '초보 테니스 전문 코치', '결제 준비 E2E 지도자입니다.', 4)`
      await tx`insert into public.lessons (id, coach_profile_id, sport_id, status, title, summary, description, region, place_name, duration_minutes, price_amount, capacity, preparation, cancellation_policy_summary) values (${fixedIds.lesson}, ${fixedIds.approvedCoachProfile}, ${tennisSportId}, 'active', 'E2E Tennis Payment Lesson', '결제 준비 화면용 로컬 레슨', '결제 준비 화면용 로컬 레슨입니다.', '서울 성동구', '성동 실내 테니스 코트', 60, 10001, 5, '운동화와 물', '24시간 이상 70% 환불')`
      await tx`insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open) values (${fixedIds.baselineOpenSchedule}, ${fixedIds.lesson}, ${futureIso(25)}, ${futureIso(26)}, 5, 1, true)`
      await tx`insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount, payment_expires_at) values (${reservationIds.pending}, ${fixedIds.lesson}, ${fixedIds.baselineOpenSchedule}, ${learnerUserId}, ${fixedIds.approvedCoachProfile}, 'pending_payment', 10001, ${futureIso(1)}), (${reservationIds.expired}, ${fixedIds.lesson}, ${fixedIds.baselineOpenSchedule}, ${learnerUserId}, ${fixedIds.approvedCoachProfile}, 'pending_payment', 10001, ${futureIso(-1)}), (${reservationIds.confirmed}, ${fixedIds.lesson}, ${fixedIds.baselineOpenSchedule}, ${learnerUserId}, ${fixedIds.approvedCoachProfile}, 'confirmed', 10001, null), (${reservationIds.cancelled}, ${fixedIds.lesson}, ${fixedIds.baselineOpenSchedule}, ${learnerUserId}, ${fixedIds.approvedCoachProfile}, 'cancelled_by_user', 10001, null), (${reservationIds.unavailable}, ${fixedIds.lesson}, ${fixedIds.baselineOpenSchedule}, ${learnerUserId}, ${fixedIds.approvedCoachProfile}, 'pending_payment', 10001, ${futureIso(1)})`
      await tx`insert into public.payments (id, reservation_id, payer_id, status, provider, provider_order_id, amount) values (${unavailablePaymentId}, ${reservationIds.unavailable}, ${learnerUserId}, 'ready', 'manual', ${`spolink_${reservationIds.unavailable}`}, 10001)`
    })
  })
}

async function expectReadyPaymentCount(reservationId: string, count: number) {
  await expect
    .poll(() =>
      withDb(async (sql) => {
        const [row] =
          await sql`select count(*)::int as count from public.payments where reservation_id = ${reservationId} and status = 'ready'`
        return row?.["count"] ?? 0
      }),
    )
    .toBe(count)
}

async function cleanupPaymentFixtures() {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`delete from public.payments where reservation_id in (${reservationIds.pending}, ${reservationIds.expired}, ${reservationIds.confirmed}, ${reservationIds.cancelled}, ${reservationIds.unavailable})`
      await tx`delete from public.reservations where lesson_id = ${fixedIds.lesson}`
      await tx`delete from public.lesson_schedules where lesson_id = ${fixedIds.lesson}`
      await tx`delete from public.lessons where id = ${fixedIds.lesson}`
      await tx`delete from public.coach_profiles where id = ${fixedIds.approvedCoachProfile}`
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
