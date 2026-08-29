import type postgres from "postgres"
import {
  buildCoachDashboardFixturePlan,
  type CoachDashboardFixturePlan,
  type CoachDashboardPersonaAlias,
  coachDashboardGraphId,
  coachDashboardPersonaAliases,
} from "./coach-dashboard-fixture-plan"

export {
  buildCoachDashboardFixturePlan,
  type CoachDashboardFixturePlan,
  type CoachDashboardPersonaAlias,
  coachDashboardPersonaAliases,
}

export async function seedCoachDashboardFixture(
  sql: postgres.Sql,
  plan: CoachDashboardFixturePlan,
  users: ReadonlyMap<CoachDashboardPersonaAlias, string>,
) {
  const sportRows = await sql<{ id: string }[]>`
    select id from public.sports where is_active = true order by created_at limit 1
  `
  const sportId = sportRows[0]?.id
  if (!sportId) throw new Error("Active sport fixture is required")
  await sql.begin(async (tx) => {
    for (const persona of plan.personas) {
      const userId = requireUser(users, persona.alias)
      if (persona.alias === "profile-required") continue
      await tx`
        insert into public.profiles
          (id, role, status, display_name, real_name, phone, default_region, deleted_at)
        values (${userId}, ${persona.coachState === "approved" ? "coach" : "learner"},
          ${persona.accountState}, ${persona.alias}, 'PII_REAL_NAME_SENTINEL',
          '010-9999-9999', '서울 강남구',
          ${persona.accountState === "deleted" ? plan.epoch : null})
      `
      if (persona.coachState) {
        await tx`
          insert into public.coach_profiles
            (id, user_id, status, primary_sport_id, service_region, headline, bio, career_years,
              submitted_at, reviewed_at, rejection_reason)
          values (${graphId(plan, `coach-${persona.alias}`)}, ${userId}, ${persona.coachState},
            ${sportId}, '서울 강남구', ${persona.alias}, 'fixture', 1,
            ${persona.coachState === "draft" ? null : plan.epoch},
            ${persona.coachState === "approved" || persona.coachState === "rejected" ? plan.epoch : null},
            ${persona.coachState === "rejected" ? "fixture rejection" : null})
        `
      }
    }
    await insertGraph(tx, plan, users, sportId)
  })
}

export async function cleanupCoachDashboardFixture(
  sql: postgres.Sql,
  plan: CoachDashboardFixturePlan,
  users: ReadonlyMap<CoachDashboardPersonaAlias, string>,
) {
  const ids = (key: keyof CoachDashboardFixturePlan["graph"]) =>
    plan.graph[key].map((row) => row.id)
  await sql`delete from public.reviews where id = any(${ids("reviews")}::uuid[])`
  await sql`delete from public.settlements where id = any(${ids("settlements")}::uuid[])`
  await sql`delete from public.payments where id = any(${ids("payments")}::uuid[])`
  await sql`delete from public.reservations where id = any(${ids("reservations")}::uuid[])`
  await sql`delete from public.notifications where id = any(${ids("notifications")}::uuid[])`
  await sql`delete from public.lesson_schedules where id = any(${ids("schedules")}::uuid[])`
  await sql`delete from public.lessons where id = any(${ids("lessons")}::uuid[])`
  await sql`delete from public.coach_profiles where id = any(${plan.personas
    .filter((persona) => persona.coachState)
    .map((persona) => graphId(plan, `coach-${persona.alias}`))}::uuid[])`
  await sql`delete from public.profiles where id = any(${fixtureUserIds(users)}::uuid[])`
}

export async function countCoachDashboardFixtureRows(
  sql: postgres.Sql,
  plan: CoachDashboardFixturePlan,
  users: ReadonlyMap<CoachDashboardPersonaAlias, string>,
) {
  const allIds = Object.values(plan.graph).flatMap((rows) => rows.map((row) => String(row["id"])))
  const userIds = fixtureUserIds(users)
  const coachProfileIds = plan.personas
    .filter((persona) => persona.coachState)
    .map((persona) => graphId(plan, `coach-${persona.alias}`))
  const rows = await sql<
    {
      coach_profiles_remaining: number
      graph_rows_remaining: number
      profiles_remaining: number
      users_remaining: number
    }[]
  >`
    select
      (
      (select count(*) from public.lessons where id = any(${allIds}::uuid[])) +
      (select count(*) from public.lesson_schedules where id = any(${allIds}::uuid[])) +
      (select count(*) from public.reservations where id = any(${allIds}::uuid[])) +
      (select count(*) from public.payments where id = any(${allIds}::uuid[])) +
      (select count(*) from public.settlements where id = any(${allIds}::uuid[])) +
      (select count(*) from public.reviews where id = any(${allIds}::uuid[])) +
      (select count(*) from public.notifications where id = any(${allIds}::uuid[]))
      )::int as graph_rows_remaining,
      (select count(*)::int from public.profiles where id = any(${userIds}::uuid[]))
        as profiles_remaining,
      (select count(*)::int from public.coach_profiles where id = any(${coachProfileIds}::uuid[]))
        as coach_profiles_remaining,
      (select count(*)::int from auth.users where id = any(${userIds}::uuid[]))
        as users_remaining
  `
  const row = rows[0]
  return {
    coachProfilesRemaining: row?.coach_profiles_remaining ?? -1,
    graphRowsRemaining: row?.graph_rows_remaining ?? -1,
    profilesRemaining: row?.profiles_remaining ?? -1,
    usersRemaining: row?.users_remaining ?? -1,
  }
}

function graphId(plan: CoachDashboardFixturePlan, alias: string) {
  return coachDashboardGraphId(plan, alias)
}

function requireUser(
  users: ReadonlyMap<CoachDashboardPersonaAlias, string>,
  alias: CoachDashboardPersonaAlias,
) {
  const value = users.get(alias)
  if (!value) throw new Error(`Missing fixture user for alias: ${alias}`)
  return value
}

function fixtureUserIds(users: ReadonlyMap<CoachDashboardPersonaAlias, string>) {
  return coachDashboardPersonaAliases.map((alias) => requireUser(users, alias))
}

async function insertGraph(
  tx: postgres.TransactionSql,
  plan: CoachDashboardFixturePlan,
  users: ReadonlyMap<CoachDashboardPersonaAlias, string>,
  sportId: string,
) {
  const ownerCoach = graphId(plan, "coach-approved-owner")
  const foreignCoach = graphId(plan, "coach-foreign-coach")
  for (const lesson of plan.graph.lessons) {
    await tx`insert into public.lessons
      (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity)
      values (${lesson.id}, ${lesson.owner === "approved-owner" ? ownerCoach : foreignCoach},
        ${sportId}, 'active', ${lesson.title}, 'fixture', '서울 강남구', 60, 10000, 4)`
  }
  for (const schedule of plan.graph.schedules) {
    await tx`insert into public.lesson_schedules
      (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open)
      values (${schedule.id}, ${schedule.lesson}, ${schedule.startsAt},
        ${(new Date(Date.parse(schedule.startsAt) + 3_600_000)).toISOString()}, 4,
        ${schedule.reservedCount}, ${schedule.isOpen})`
  }
  for (const reservation of plan.graph.reservations) {
    await tx`insert into public.reservations
      (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status,
        reserved_price_amount, payment_expires_at, confirmed_at, completed_at)
      values (${reservation.id}, ${reservation.lesson}, ${reservation.schedule},
        ${requireUser(users, "learner-reviewer")},
        ${reservation.owner === "approved-owner" ? ownerCoach : foreignCoach},
        ${reservation.status}, 10000, ${plan.epoch},
        ${reservation.status === "confirmed" ? plan.epoch : null},
        ${reservation.status === "completed" ? plan.epoch : null})`
  }
  for (const [index, payment] of plan.graph.payments.entries()) {
    await tx`insert into public.payments
      (id, reservation_id, payer_id, status, provider_order_id, amount, approved_at)
      values (${payment.id}, ${payment.reservation}, ${requireUser(users, "learner-reviewer")},
        ${payment.status}, ${`fixture-order-${index}-${plan.epoch}`}, 10000,
        ${payment.status === "paid" ? plan.epoch : null})`
  }
  for (const settlement of plan.graph.settlements) {
    await tx`insert into public.settlements
      (id, reservation_id, coach_profile_id, payment_id, status, gross_amount,
        platform_fee_amount, payment_fee_amount, refund_amount, net_amount)
      values (${settlement.id}, ${settlement.reservation},
        ${settlement.owner === "approved-owner" ? ownerCoach : foreignCoach},
        ${settlement.payment}, ${settlement.status}, ${settlement.netAmount + 1500},
        1000, 500, 0, ${settlement.netAmount})`
  }
  for (const review of plan.graph.reviews) {
    await tx`insert into public.reviews
      (id, reservation_id, lesson_id, coach_profile_id, reviewer_id, status, rating, content,
        hidden_reason, created_at)
      values (${review.id}, ${review.reservation}, ${review.lesson},
        ${review.owner === "approved-owner" ? ownerCoach : foreignCoach},
        ${requireUser(users, "learner-reviewer")}, ${review.status}, 5, ${review.content},
        ${review.status === "hidden" ? "fixture hidden" : null}, ${review.createdAt})`
  }
  for (const notification of plan.graph.notifications) {
    await tx`insert into public.notifications
      (id, user_id, type, title, body, data, read_at, created_at)
      values (${notification.id},
        ${requireUser(users, notification.owner)},
        'reservation_confirmed', ${notification.title}, ${notification.body},
        jsonb_build_object(
          'reservationId', ${notification.reservation}::text,
          'paymentId', ${notification.payment}::text
        ),
        ${notification.read ? plan.epoch : null}, ${notification.createdAt})`
  }
}
