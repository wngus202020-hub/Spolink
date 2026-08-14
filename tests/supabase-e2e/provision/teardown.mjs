import {
  fixedIds,
  fixedPaymentIds,
  fixedReservationIds,
  fixedScheduleIds,
  fixtureUsers,
  generatedSideEffectPredicates,
} from "../fixtures.mjs"
import { listFixtureAuthUsers } from "./auth-lifecycle.mjs"

export async function cleanupFixtureGraph(sql, serviceClient, authUsers = null) {
  const users = authUsers ?? (serviceClient ? await listFixtureAuthUsers(serviceClient) : [])
  const profileIds = [
    ...users.map((user) => user.id),
    ...(
      await sql`select id::text as id from public.profiles where display_name in ${sql(fixtureUsers.map((user) => user.displayName))}`
    ).map((row) => row.id),
  ]
  const predicates = generatedSideEffectPredicates([...new Set(profileIds)])
  await sql.begin(async (tx) => {
    await tx`delete from public.refunds where reservation_id in ${tx(predicates.refundReservationIds)} or payment_id in ${tx(predicates.refundPaymentIds)}`
    if (predicates.notificationUserIds.length > 0) {
      await tx`delete from public.notifications where user_id in ${tx(predicates.notificationUserIds)} or data->>'reservationId' in ${tx(predicates.notificationReservationIds)}`
    } else {
      await tx`delete from public.notifications where data->>'reservationId' in ${tx(predicates.notificationReservationIds)}`
    }
    if (predicates.auditActorIds.length > 0) {
      await tx`delete from public.audit_logs where target_id in ${tx(predicates.auditTargetIds)} or actor_id in ${tx(predicates.auditActorIds)}`
    } else {
      await tx`delete from public.audit_logs where target_id in ${tx(predicates.auditTargetIds)}`
    }
    await tx`delete from public.payments where id in ${tx(fixedPaymentIds())} or reservation_id in ${tx(fixedReservationIds())}`
    await tx`delete from public.reservations where id in ${tx(fixedReservationIds())}`
    await tx`delete from public.lesson_schedules where id in ${tx(fixedScheduleIds())}`
    await tx`delete from public.lessons where id = ${fixedIds.lesson}`
    await tx`delete from public.coach_profiles where id in ${tx([fixedIds.approvedCoachProfile, fixedIds.pendingCoachProfile])}`
    if (profileIds.length > 0) {
      await tx`delete from public.profiles where id in ${tx([...new Set(profileIds)])}`
    }
  })
  for (const user of users) {
    const { error } = await serviceClient.auth.admin.deleteUser(user.id)
    if (error && !/not found/i.test(error.message)) {
      throw error
    }
  }
}

export async function readFixtureCounts(sql) {
  const [row] = await sql`
    select
      (select count(*)::int from public.profiles where display_name like 'E2E %') as "profiles",
      (select count(*)::int from public.coach_profiles where id in (${fixedIds.approvedCoachProfile}, ${fixedIds.pendingCoachProfile})) as "coachProfiles",
      (select count(*)::int from public.lessons where id = ${fixedIds.lesson}) as "lessons",
      (select count(*)::int from public.lesson_schedules where id in ${sql(fixedScheduleIds())}) as "schedules",
      (select count(*)::int from public.reservations where id in ${sql(fixedReservationIds())}) as "reservations",
      (select count(*)::int from public.payments where id in ${sql(fixedPaymentIds())}) as "payments",
      (select count(*)::int from public.refunds where id = ${fixedIds.historyRefund}) as "refunds",
      (select count(*)::int from public.notifications where data->>'reservationId' in ${sql(fixedReservationIds())}) as "notifications",
      (select count(*)::int from public.audit_logs where target_id in ${sql([...fixedReservationIds(), ...fixedPaymentIds()])}) as "auditLogs"
  `
  return row
}

export async function assertNoFixtureResidue(sql) {
  const counts = await readFixtureCounts(sql)
  for (const [key, value] of Object.entries(counts)) {
    if (value !== 0) {
      throw new Error(`Fixture cleanup left ${value} ${key}`)
    }
  }
}
