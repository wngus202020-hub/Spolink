import { fixedIds } from "../fixtures.mjs"

export async function insertFixtureGraph(sql, rows) {
  await sql.begin(async (tx) => {
    await tx`insert into public.profiles ${tx(rows.profiles)}`
    await tx`insert into public.coach_profiles ${tx(rows.coachProfiles)}`
    await tx`insert into public.lessons ${tx(rows.lessons)}`
    await tx`insert into public.lesson_schedules ${tx(rows.schedules)}`
    await tx`insert into public.reservations ${tx(rows.reservations)}`
    await tx`insert into public.payments ${tx(rows.payments)}`
    await tx`insert into public.refunds ${tx(rows.refunds)}`
  })
}

export async function readTennisSportId(sql) {
  const rows = await sql`select id::text as id from public.sports where slug = 'tennis'`
  if (rows.length !== 1) throw new Error("Expected one seeded tennis sport")
  return rows[0].id
}

export async function assertLessonSport(sql, tennisSportId) {
  const [row] =
    await sql`select sport_id::text as sport_id from public.lessons where id = ${fixedIds.lesson}`
  if (row?.sport_id !== tennisSportId) {
    throw new Error("Fixture lesson must use the seeded tennis sport")
  }
}
