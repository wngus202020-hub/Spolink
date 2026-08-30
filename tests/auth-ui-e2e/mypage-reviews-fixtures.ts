import postgres from "postgres"

const uuid = (suffix: number) => `76000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`
const negativeReviewState = { status: "deleted" } as const

export const fixtureManifest = {
  coachProfile: uuid(1),
  lessons: { active: uuid(2), inactive: uuid(3) },
  messages: [] as readonly string[],
  negativeReview: uuid(4),
  reservations: {
    ownerA: Array.from({ length: 21 }, (_, index) => uuid(100 + index)),
    ownerB: uuid(200),
    deleted: uuid(201),
  },
  schedules: { active: uuid(5), inactive: uuid(6) },
} as const

export const activeLessonTitle = "리뷰 내역 활성 레슨"
export const inactiveLessonTitle = "리뷰 내역 종료 레슨"
export const hiddenReason = "운영 정책 확인"

export type ReviewUserIds = Readonly<{
  admin: string
  coach: string
  ownerA: string
  ownerB: string
  profileless: string
}>

export async function seedReviewPrerequisites(users: ReviewUserIds): Promise<void> {
  await withDb(async (sql) => {
    const [sport] = await sql`select id::text as id from public.sports where slug = 'tennis'`
    const sportId = sport?.["id"]
    if (typeof sportId !== "string") throw new Error("Missing tennis sport fixture.")
    const ownerAReservations = fixtureManifest.reservations.ownerA
    await sql.begin(async (tx) => {
      await tx`insert into public.profiles (id, display_name, role, status) values
        (${users.ownerA}, '리뷰 소유자 A', 'learner', 'active'),
        (${users.ownerB}, '리뷰 소유자 B', 'learner', 'active'),
        (${users.coach}, '리뷰 지도자', 'coach', 'coach_approved'),
        (${users.admin}, '리뷰 관리자', 'admin', 'active')`
      await tx`insert into public.coach_profiles
        (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years)
        values (${fixtureManifest.coachProfile}, ${users.coach}, 'approved', ${sportId},
        '서울', '리뷰 E2E 지도자', '리뷰 내역 테스트', 5)`
      await tx`insert into public.lessons
        (id, coach_profile_id, sport_id, status, title, description, region,
         duration_minutes, price_amount, capacity)
        values
        (${fixtureManifest.lessons.active}, ${fixtureManifest.coachProfile}, ${sportId},
         'active', ${activeLessonTitle}, '리뷰 내역 테스트', '서울', 60, 10000, 30),
        (${fixtureManifest.lessons.inactive}, ${fixtureManifest.coachProfile}, ${sportId},
         'closed', ${inactiveLessonTitle}, '비활성 리뷰 테스트', '서울', 60, 10000, 30)`
      await tx`insert into public.lesson_schedules
        (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open)
        values
        (${fixtureManifest.schedules.active}, ${fixtureManifest.lessons.active},
         now() + interval '30 days', now() + interval '30 days' + interval '1 hour', 30, 22, true),
        (${fixtureManifest.schedules.inactive}, ${fixtureManifest.lessons.inactive},
         now() - interval '29 days', now() - interval '29 days' + interval '1 hour', 30, 1, false)`
      for (const [index, reservationId] of ownerAReservations.entries()) {
        const inactive = index === ownerAReservations.length - 1
        await tx`insert into public.reservations
          (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status,
           reserved_price_amount, completed_at, created_at)
          values (${reservationId},
          ${inactive ? fixtureManifest.lessons.inactive : fixtureManifest.lessons.active},
          ${inactive ? fixtureManifest.schedules.inactive : fixtureManifest.schedules.active},
          ${users.ownerA}, ${fixtureManifest.coachProfile}, 'completed', 10000,
          now() - interval '20 days', now() - interval '40 days')`
      }
      await tx`insert into public.reservations
        (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status,
         reserved_price_amount, completed_at, created_at)
        values
        (${fixtureManifest.reservations.ownerB}, ${fixtureManifest.lessons.active},
         ${fixtureManifest.schedules.active}, ${users.ownerB}, ${fixtureManifest.coachProfile},
         'completed', 10000, now() - interval '20 days', now() - interval '40 days'),
        (${fixtureManifest.reservations.deleted}, ${fixtureManifest.lessons.active},
         ${fixtureManifest.schedules.active}, ${users.ownerA}, ${fixtureManifest.coachProfile},
         'completed', 10000, now() - interval '20 days', now() - interval '40 days')`
    })
  })
}

export async function stabilizeAndInsertDeleted(
  reviewIds: readonly string[],
  users: ReviewUserIds,
) {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      for (const [index, reviewId] of reviewIds.entries()) {
        await tx`update public.reviews set created_at =
          timestamptz '2026-08-01 00:00:00+00' + (${index} * interval '1 minute')
          where id = ${reviewId}`
      }
      await tx`insert into public.reviews
        (id, reservation_id, lesson_id, coach_profile_id, reviewer_id, status, rating,
         content, created_at)
        values (${fixtureManifest.negativeReview}, ${fixtureManifest.reservations.deleted},
        ${fixtureManifest.lessons.active}, ${fixtureManifest.coachProfile}, ${users.ownerA},
        ${negativeReviewState.status}, 1, '삭제 음성 fixture', timestamptz '2026-08-02 00:00:00+00')`
    })
  })
}

export async function revokeAuthenticatedReviewSelect(): Promise<void> {
  await withDb((sql) =>
    sql`revoke select on table public.reviews from authenticated`.then(() => {}),
  )
}

export async function restoreAuthenticatedReviewSelect(): Promise<void> {
  await withDb((sql) => sql`grant select on table public.reviews to authenticated`.then(() => {}))
}

export async function cleanupReviewFixtures(
  userIds: readonly string[],
  reviewIds: readonly string[],
) {
  const reservationIds = [
    ...fixtureManifest.reservations.ownerA,
    fixtureManifest.reservations.ownerB,
    fixtureManifest.reservations.deleted,
  ]
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await tx`delete from public.audit_logs where target_type = 'review'
        and target_id = any(${reviewIds}::uuid[])`
      await tx`delete from public.reviews where reservation_id = any(${reservationIds}::uuid[])`
      await tx`delete from public.reservations where id = any(${reservationIds}::uuid[])`
      await tx`delete from public.lesson_schedules where id in
        (${fixtureManifest.schedules.active}, ${fixtureManifest.schedules.inactive})`
      await tx`delete from public.lessons where id in
        (${fixtureManifest.lessons.active}, ${fixtureManifest.lessons.inactive})`
      await tx`delete from public.coach_profiles where id = ${fixtureManifest.coachProfile}`
      await tx`delete from auth.users where id = any(${userIds}::uuid[])`
    })
  })
  return probeExactCleanup(userIds, reviewIds)
}

async function probeExactCleanup(userIds: readonly string[], reviewIds: readonly string[]) {
  return withDb(async (sql) => {
    const reservationIds = [
      ...fixtureManifest.reservations.ownerA,
      fixtureManifest.reservations.ownerB,
      fixtureManifest.reservations.deleted,
    ]
    const [row] = await sql`select
      (select count(*)::int from public.audit_logs where target_type = 'review'
        and target_id = any(${reviewIds}::uuid[])) as audits,
      (select count(*)::int from public.reviews where reservation_id = any(${reservationIds}::uuid[])) as reviews,
      (select count(*)::int from public.reservations where id = any(${reservationIds}::uuid[])) as reservations,
      (select count(*)::int from public.lessons where id in (${fixtureManifest.lessons.active}, ${fixtureManifest.lessons.inactive})) as lessons,
      (select count(*)::int from public.lesson_schedules where id in (${fixtureManifest.schedules.active}, ${fixtureManifest.schedules.inactive})) as schedules,
      (select count(*)::int from public.coach_profiles where id = ${fixtureManifest.coachProfile}) as coaches,
      (select count(*)::int from public.profiles where id = any(${userIds}::uuid[])) as profiles,
      (select count(*)::int from auth.users where id = any(${userIds}::uuid[])) as users`
    return {
      cleanupCounters: {
        audits: Number(row?.["audits"]),
        coaches: Number(row?.["coaches"]),
        lessons: Number(row?.["lessons"]),
        messages: 0,
        profiles: Number(row?.["profiles"]),
        reservations: Number(row?.["reservations"]),
        reviews: Number(row?.["reviews"]),
        schedules: Number(row?.["schedules"]),
        users: Number(row?.["users"]),
      },
    }
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
