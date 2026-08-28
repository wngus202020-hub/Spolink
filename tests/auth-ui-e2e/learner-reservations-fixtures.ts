import postgres from "postgres"

export const fixtureIds = {
  coachProfile: "10000000-0000-4000-8000-000000000701",
  foreignLesson: "20000000-0000-4000-8000-000000000702",
  foreignSchedule: "30000000-0000-4000-8000-000000000702",
  lesson: "20000000-0000-4000-8000-000000000701",
  mismatchSchedule: "30000000-0000-4000-8000-000000000703",
  schedule: "30000000-0000-4000-8000-000000000701",
} as const

export const reservationIds = {
  cancelled: "40000000-0000-4000-8000-000000000705",
  completed: "40000000-0000-4000-8000-000000000704",
  confirmed: "40000000-0000-4000-8000-000000000703",
  disputed: "40000000-0000-4000-8000-000000000707",
  expired: "40000000-0000-4000-8000-000000000702",
  foreign: "40000000-0000-4000-8000-000000000708",
  mismatch: "40000000-0000-4000-8000-000000000709",
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

export const ownedLessonTitle = "성수 테니스 기본기 클래스"
export const foreignLessonTitle = "외부 소유 비공개 예약"
export const visualCoachDisplayName = "담당 지도자"

type ReservationFixtureStates = Readonly<{
  cancelled: string
  completed: string
  confirmed: string
  disputed: string
  expired: string
  foreign: string
  mismatch: string
  noShow: string
  pending: string
}>

export async function seedLearnerReservationFixtures({
  coachUserId,
  foreignLearnerUserId,
  learnerUserId,
  paymentExpiresAt,
  reservationFixtureStates,
}: Readonly<{
  coachUserId: string
  foreignLearnerUserId: string
  learnerUserId: string
  paymentExpiresAt: Readonly<{ expired: string; pending: string }>
  reservationFixtureStates: ReservationFixtureStates
}>) {
  const endsAt = futureIso(26)
  const startsAt = futureIso(25)
  const foreignStartsAt = futureIso(30)
  const foreignEndsAt = futureIso(31)
  const mismatchStartsAt = futureIso(35)
  const mismatchEndsAt = futureIso(36)
  const tennisSportId = await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    return sport?.["id"]
  })
  if (typeof tennisSportId !== "string") throw new Error("Missing seeded tennis sport.")

  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${learnerUserId}, '김스포', '김예약', '010-1111-1111', '서울 성동구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region) values (${foreignLearnerUserId}, '외부 학습자', '이외부', '010-2222-2222', '서울 마포구')`
      await tx`insert into public.profiles (id, display_name, real_name, phone, default_region, role, status) values (${coachUserId}, ${visualCoachDisplayName}, '박지도', '010-3333-3333', '서울 성동구', 'coach', 'coach_approved')`
      await tx`insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years) values (${fixtureIds.coachProfile}, ${coachUserId}, 'approved', ${tennisSportId}, '서울 성동구', '학습자 예약 E2E 지도자', '학습자 예약 목록과 상세를 검증합니다.', 5)`
      await tx`insert into public.lessons (id, coach_profile_id, sport_id, status, title, summary, description, region, place_name, duration_minutes, price_amount, capacity, preparation, cancellation_policy_summary) values (${fixtureIds.lesson}, ${fixtureIds.coachProfile}, ${tennisSportId}, 'active', ${ownedLessonTitle}, '학습자 예약 E2E 레슨', '학습자 예약 목록과 상세 화면을 검증합니다.', '서울 성동구', '성동 실내 테니스 코트', 60, 10001, 10, '운동화와 물', '24시간 이상 70%, 3시간 이상 24시간 미만 50%, 3시간 미만 환불 불가'), (${fixtureIds.foreignLesson}, ${fixtureIds.coachProfile}, ${tennisSportId}, 'active', ${foreignLessonTitle}, '외부 소유 예약 E2E 레슨', '외부 소유 예약 정보가 노출되지 않는지 검증합니다.', '서울 마포구', '마포 비공개 코트', 60, 20000, 2, '운동화', '24시간 이상 70% 환불')`
      await tx`insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open) values (${fixtureIds.schedule}, ${fixtureIds.lesson}, ${startsAt}, ${endsAt}, 10, 1, true), (${fixtureIds.foreignSchedule}, ${fixtureIds.foreignLesson}, ${foreignStartsAt}, ${foreignEndsAt}, 2, 1, true), (${fixtureIds.mismatchSchedule}, ${fixtureIds.lesson}, ${mismatchStartsAt}, ${mismatchEndsAt}, 10, 1, true)`
      await tx`insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount, payment_expires_at, confirmed_at, completed_at, cancelled_at, no_show_marked_at, dispute_reason, created_at) values (${reservationIds.pending}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.pending)}, 10001, ${paymentExpiresAt.pending}, null, null, null, null, null, now() - interval '1 minute'), (${reservationIds.expired}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.expired)}, 10001, ${paymentExpiresAt.expired}, null, null, null, null, null, now() - interval '2 minutes'), (${reservationIds.confirmed}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.confirmed)}, 10001, null, now(), null, null, null, null, now() - interval '3 minutes'), (${reservationIds.completed}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.completed)}, 10001, null, now() - interval '2 days', now() - interval '1 day', null, null, null, now() - interval '4 minutes'), (${reservationIds.cancelled}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.cancelled)}, 10001, null, now() - interval '2 days', null, now() - interval '1 day', null, null, now() - interval '5 minutes'), (${reservationIds.noShow}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.noShow)}, 10001, null, now() - interval '2 days', null, null, now() - interval '1 day', null, now() - interval '6 minutes'), (${reservationIds.disputed}, ${fixtureIds.lesson}, ${fixtureIds.schedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.disputed)}, 10001, null, now() - interval '2 days', null, null, null, '수업 진행 확인 중', now() - interval '7 minutes'), (${reservationIds.foreign}, ${fixtureIds.foreignLesson}, ${fixtureIds.foreignSchedule}, ${foreignLearnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.foreign)}, 20000, null, now(), null, null, null, null, now() - interval '8 minutes'), (${reservationIds.mismatch}, ${fixtureIds.lesson}, ${fixtureIds.mismatchSchedule}, ${learnerUserId}, ${fixtureIds.coachProfile}, ${reservationStatusValue(reservationFixtureStates.mismatch)}, 10001, null, now(), null, null, null, null, now() - interval '9 minutes')`
      await tx`insert into public.payments (id, reservation_id, payer_id, status, provider, provider_order_id, amount, approved_at) values (${paymentIds.confirmed}, ${reservationIds.confirmed}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.confirmed}`}, 10001, now()), (${paymentIds.completed}, ${reservationIds.completed}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.completed}`}, 10001, now() - interval '2 days'), (${paymentIds.cancelled}, ${reservationIds.cancelled}, ${learnerUserId}, 'refunded', 'toss', ${`e2e_${reservationIds.cancelled}`}, 10001, now() - interval '2 days'), (${paymentIds.noShow}, ${reservationIds.noShow}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.noShow}`}, 10001, now() - interval '2 days'), (${paymentIds.disputed}, ${reservationIds.disputed}, ${learnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.disputed}`}, 10001, now() - interval '2 days'), (${paymentIds.foreign}, ${reservationIds.foreign}, ${foreignLearnerUserId}, 'paid', 'toss', ${`e2e_${reservationIds.foreign}`}, 20000, now())`
      await tx`insert into public.refunds (id, payment_id, reservation_id, requested_by, amount, reason, source, status, processed_at, provider_refund_key) values ('60000000-0000-4000-8000-000000000705', ${paymentIds.cancelled}, ${reservationIds.cancelled}, ${learnerUserId}, 7000, '학습자 취소 환불', 'reservation_cancellation', 'completed', now(), 'e2e-refund-cancelled')`
    })
  })

  return { endsAt, startsAt }
}

export async function cleanupLearnerReservationFixtures() {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`delete from public.refunds where reservation_id in (${reservationIds.cancelled}, ${reservationIds.completed}, ${reservationIds.confirmed}, ${reservationIds.disputed}, ${reservationIds.expired}, ${reservationIds.foreign}, ${reservationIds.mismatch}, ${reservationIds.noShow}, ${reservationIds.pending})`
      await tx`delete from public.payments where reservation_id in (${reservationIds.cancelled}, ${reservationIds.completed}, ${reservationIds.confirmed}, ${reservationIds.disputed}, ${reservationIds.expired}, ${reservationIds.foreign}, ${reservationIds.mismatch}, ${reservationIds.noShow}, ${reservationIds.pending})`
      await tx`delete from public.reservations where id in (${reservationIds.cancelled}, ${reservationIds.completed}, ${reservationIds.confirmed}, ${reservationIds.disputed}, ${reservationIds.expired}, ${reservationIds.foreign}, ${reservationIds.mismatch}, ${reservationIds.noShow}, ${reservationIds.pending})`
      await tx`delete from public.lesson_schedules where id in (${fixtureIds.foreignSchedule}, ${fixtureIds.mismatchSchedule}, ${fixtureIds.schedule})`
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

function reservationStatusValue(sqlLiteral: string) {
  return sqlLiteral.slice(1, -1)
}

function futureIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}
