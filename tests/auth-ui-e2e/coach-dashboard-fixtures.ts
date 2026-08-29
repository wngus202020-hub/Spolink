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
      await tx`
        insert into public.profiles (id, role, status, display_name, real_name, default_region, deleted_at)
        values (${userId}, ${persona.coachState === "approved" ? "coach" : "learner"},
          ${persona.accountState}, ${persona.alias}, ${persona.alias}, '서울 강남구',
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
}

export async function countCoachDashboardFixtureRows(
  sql: postgres.Sql,
  plan: CoachDashboardFixturePlan,
) {
  const allIds = Object.values(plan.graph).flatMap((rows) => rows.map((row) => String(row["id"])))
  const rows = await sql<{ count: number }[]>`
    select (
      (select count(*) from public.lessons where id = any(${allIds}::uuid[])) +
      (select count(*) from public.lesson_schedules where id = any(${allIds}::uuid[])) +
      (select count(*) from public.reservations where id = any(${allIds}::uuid[])) +
      (select count(*) from public.payments where id = any(${allIds}::uuid[])) +
      (select count(*) from public.settlements where id = any(${allIds}::uuid[])) +
      (select count(*) from public.reviews where id = any(${allIds}::uuid[])) +
      (select count(*) from public.notifications where id = any(${allIds}::uuid[]))
    )::int as count
  `
  return rows[0]?.count ?? -1
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
      values (${lesson["id"]}, ${lesson["coach"] === "approved-owner" ? ownerCoach : foreignCoach},
        ${sportId}, 'active', ${lesson["title"]}, 'fixture', '서울 강남구', 60, 10000, 4)`
  }
  for (const schedule of plan.graph.schedules) {
    await tx`insert into public.lesson_schedules
      (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open)
      values (${schedule["id"]}, ${schedule["lesson"]}, ${schedule["startsAt"]},
        ${(new Date(Date.parse(String(schedule["startsAt"])) + 3_600_000)).toISOString()}, 4, 1, true)`
  }
  for (const reservation of plan.graph.reservations) {
    await tx`insert into public.reservations
      (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status,
        reserved_price_amount, payment_expires_at, confirmed_at)
      values (${reservation["id"]}, ${reservation["lesson"]}, ${reservation["schedule"]},
        ${requireUser(users, "learner-reviewer")},
        ${reservation["coach"] === "approved-owner" ? ownerCoach : foreignCoach},
        ${reservation["status"]}, 10000, ${plan.epoch},
        ${reservation["status"] === "confirmed" ? plan.epoch : null})`
  }
  for (const [index, payment] of plan.graph.payments.entries()) {
    await tx`insert into public.payments
      (id, reservation_id, payer_id, status, provider_order_id, amount, approved_at)
      values (${payment["id"]}, ${payment["reservation"]}, ${requireUser(users, "learner-reviewer")},
        ${payment["status"]}, ${`fixture-order-${index}-${plan.epoch}`}, 10000,
        ${payment["status"] === "paid" ? plan.epoch : null})`
  }
  for (const settlement of plan.graph.settlements) {
    await tx`insert into public.settlements
      (id, reservation_id, coach_profile_id, payment_id, status, gross_amount,
        platform_fee_amount, payment_fee_amount, refund_amount, net_amount)
      values (${settlement["id"]}, ${settlement["reservation"]},
        ${settlement["coach"] === "approved-owner" ? ownerCoach : foreignCoach},
        ${settlement["payment"]}, 'pending', 10000, 1000, 500, 0, 8500)`
  }
  const review = plan.graph.reviews[0]
  if (!review) throw new Error("Review fixture is required")
  await tx`insert into public.reviews
    (id, reservation_id, lesson_id, coach_profile_id, reviewer_id, status, rating, content, created_at)
    values (${review["id"]}, ${review["reservation"]}, ${review["lesson"]}, ${ownerCoach},
      ${requireUser(users, "learner-reviewer")}, 'visible', 5, 'fixture review', ${review["createdAt"]})`
  for (const notification of plan.graph.notifications) {
    await tx`insert into public.notifications (id, user_id, type, title, body, data, created_at)
      values (${notification["id"]},
        ${requireUser(users, notification["owner"])},
        'reservation_confirmed', 'fixture notification', 'fixture body',
        jsonb_build_object(
          'reservationId', ${notification.reservation}::text,
          'paymentId', ${notification.payment}::text
        ),
        ${notification["createdAt"]})`
  }
}
