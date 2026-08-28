import assert from "node:assert/strict"
import postgres from "postgres"

const dbUrl = process.env["SPOLINK_AUTH_E2E_DB_URL"]
if (!dbUrl) throw new Error("SPOLINK_AUTH_E2E_DB_URL is required.")

const ids = Object.freeze({
  adminA: "58000000-0000-4000-8000-000000000001",
  adminB: "58000000-0000-4000-8000-000000000002",
  learner: "58000000-0000-4000-8000-000000000003",
  coach: "58000000-0000-4000-8000-000000000004",
  coachProfile: "58100000-0000-4000-8000-000000000001",
  lesson: "58200000-0000-4000-8000-000000000001",
  schedule: "58300000-0000-4000-8000-000000000001",
  reservation: "58400000-0000-4000-8000-000000000001",
  reservationTwo: "58400000-0000-4000-8000-000000000002",
  sameReasonReview: "58500000-0000-4000-8000-000000000001",
  conflictReview: "58500000-0000-4000-8000-000000000002",
})

const sql = postgres(dbUrl, { idle_timeout: 1, max: 3 })

try {
  await seed()
  const sameReason = await runConcurrentHide(ids.sameReasonReview, "같은 사유")
  assert.deepEqual(
    sameReason.map((row) => row.idempotent).sort(),
    [false, true],
    "concurrent same decisions have one writer and one idempotent replay",
  )
  assert.equal(await auditCount(ids.sameReasonReview), 1)

  const conflicting = await Promise.allSettled([
    hide(ids.conflictReview, ids.adminA, "사유 A"),
    hide(ids.conflictReview, ids.adminB, "사유 B"),
  ])
  assert.equal(conflicting.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(conflicting.filter((result) => result.status === "rejected").length, 1)
  assert.equal(await auditCount(ids.conflictReview), 1)
  console.log(
    JSON.stringify({
      concurrentSameReason: "one-write-one-idempotent",
      conflicting: "one-winner-one-stale",
      auditRows: 2,
    }),
  )
} finally {
  await cleanup()
  await sql.end({ timeout: 1 })
}

async function seed() {
  await sql.begin(async (tx) => {
    await tx`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values
        ('00000000-0000-0000-0000-000000000000', ${ids.adminA}, 'authenticated', 'authenticated', 'task5-live-admin-a@example.test', '', now(), '{"provider":"email"}', '{}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', ${ids.adminB}, 'authenticated', 'authenticated', 'task5-live-admin-b@example.test', '', now(), '{"provider":"email"}', '{}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', ${ids.learner}, 'authenticated', 'authenticated', 'task5-live-learner@example.test', '', now(), '{"provider":"email"}', '{}', now(), now()),
        ('00000000-0000-0000-0000-000000000000', ${ids.coach}, 'authenticated', 'authenticated', 'task5-live-coach@example.test', '', now(), '{"provider":"email"}', '{}', now(), now())
    `
    await tx`
      insert into public.profiles (id, display_name, role, status) values
        (${ids.adminA}, 'Task5 live admin A', 'admin', 'active'),
        (${ids.adminB}, 'Task5 live admin B', 'admin', 'active'),
        (${ids.learner}, 'Task5 live learner', 'learner', 'active'),
        (${ids.coach}, 'Task5 live coach', 'coach', 'coach_approved')
    `
    const [sport] = await tx`select id from public.sports where slug = 'tennis' limit 1`
    assert.equal(typeof sport?.id, "string")
    await tx`
      insert into public.coach_profiles (id, user_id, status, service_region)
      values (${ids.coachProfile}, ${ids.coach}, 'approved', '서울')
    `
    await tx`
      insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity)
      values (${ids.lesson}, ${ids.coachProfile}, ${sport.id}, 'active', 'Task5 live review', 'Concurrent review fixture', '서울', 60, 10000, 2)
    `
    await tx`
      insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count)
      values (${ids.schedule}, ${ids.lesson}, now() + interval '1 day', now() + interval '1 day 1 hour', 2, 1)
    `
    await tx`
      insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount)
      values
        (${ids.reservation}, ${ids.lesson}, ${ids.schedule}, ${ids.learner}, ${ids.coachProfile}, 'completed', 10000),
        (${ids.reservationTwo}, ${ids.lesson}, ${ids.schedule}, ${ids.learner}, ${ids.coachProfile}, 'completed', 10000)
    `
    await tx`
      insert into public.reviews (id, reservation_id, lesson_id, coach_profile_id, reviewer_id, status, rating, content)
      values
        (${ids.sameReasonReview}, ${ids.reservation}, ${ids.lesson}, ${ids.coachProfile}, ${ids.learner}, 'visible', 5, 'same'),
        (${ids.conflictReview}, ${ids.reservationTwo}, ${ids.lesson}, ${ids.coachProfile}, ${ids.learner}, 'visible', 4, 'conflict')
    `
  })
}

async function hide(reviewId, actorId, reason) {
  const connection = postgres(dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await connection.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId, role: "authenticated" })}, true)`
      await tx`select set_config('request.jwt.claim.sub', ${actorId}, true)`
      await tx`set local role authenticated`
      const [row] = await tx`select * from public.hide_review(${reviewId}, ${reason})`
      return row
    })
  } finally {
    await connection.end({ timeout: 1 })
  }
}

async function runConcurrentHide(reviewId, reason) {
  return Promise.all([hide(reviewId, ids.adminA, reason), hide(reviewId, ids.adminB, reason)])
}

async function auditCount(reviewId) {
  const [row] =
    await sql`select count(*)::int as count from public.audit_logs where action = 'review.hidden' and target_id = ${reviewId}`
  return row.count
}

async function cleanup() {
  await sql`delete from public.audit_logs where target_id = any(${sql.array([ids.sameReasonReview, ids.conflictReview])}::uuid[])`
  await sql`delete from public.reviews where id = any(${sql.array([ids.sameReasonReview, ids.conflictReview])}::uuid[])`
  await sql`delete from public.reservations where id = any(${sql.array([ids.reservation, ids.reservationTwo])}::uuid[])`
  await sql`delete from public.lesson_schedules where id = ${ids.schedule}`
  await sql`delete from public.lessons where id = ${ids.lesson}`
  await sql`delete from public.coach_profiles where id = ${ids.coachProfile}`
  await sql`delete from public.profiles where id = any(${sql.array([ids.adminA, ids.adminB, ids.learner, ids.coach])}::uuid[])`
  await sql`delete from auth.users where id = any(${sql.array([ids.adminA, ids.adminB, ids.learner, ids.coach])}::uuid[])`
}
