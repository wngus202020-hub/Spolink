import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { readGuardedLocalStatus } from "../local-status.mjs"
import { generateRunPassword } from "../provision/auth-lifecycle.mjs"
import { createLessonImageFixtureNamespace } from "./fixture.mjs"

export async function provisionLessonImageFixtures({ runId, status: suppliedStatus } = {}) {
  const namespace = createLessonImageFixtureNamespace(runId)
  const status = suppliedStatus ?? (await readGuardedLocalStatus())
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const sql = postgres(status.dbUrl, { idle_timeout: 1, max: 1 })
  const runPassword = generateRunPassword()

  try {
    await cleanupNamespace(sql, serviceClient, namespace)
    for (const user of namespace.users) {
      const { data, error } = await serviceClient.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        id: user.id,
        password: runPassword,
      })
      if (error) throw error
      if (data.user?.id !== user.id) throw new Error("Auth fixture id did not preserve namespace")
    }
    const [sport] =
      await sql`select id::text from public.sports where is_active order by id limit 1`
    if (!sport?.id) throw new Error("Lesson-image fixture requires an active sport")
    await sql`
      insert into public.profiles (id, display_name, role, status)
      values ${sql(namespace.users.map((user) => [user.id, user.displayName, user.role, user.status]))}
    `
    const coach = findUser(namespace, "coach")
    const pendingCoach = findUser(namespace, "pendingCoach")
    await sql`
      insert into public.coach_profiles (
        id, user_id, status, primary_sport_id, service_region
      ) values
        (${namespace.approvedCoachProfileId}, ${coach.id}, 'approved', ${sport.id}, '서울 성동구'),
        (${namespace.pendingCoachProfileId}, ${pendingCoach.id}, 'submitted', ${sport.id}, '서울 성동구')
    `
  } catch (error) {
    await cleanupNamespace(sql, serviceClient, namespace).catch(() => {})
    await sql.end({ timeout: 1 })
    throw error
  }

  const authIds = Object.fromEntries(namespace.users.map((user) => [user.key, user.id]))
  return {
    authIds,
    clients: { serviceClient },
    namespace,
    rows: {
      coachProfiles: [
        { id: namespace.approvedCoachProfileId, primary_sport_id: await readSportId(sql) },
      ],
    },
    runPassword,
    status,
    users: namespace.users,
    async assertZero() {
      const ids = namespace.users.map((user) => user.id)
      const coachIds = [
        namespace.approvedCoachProfileId,
        namespace.pendingCoachProfileId,
        namespace.foreignCoachProfileId,
      ]
      const [counts] = await sql`
        select
          (select count(*)::int from auth.users where id in ${sql(ids)}) as "authUsers",
          (select count(*)::int from public.profiles where id in ${sql(ids)}) as profiles,
          (select count(*)::int from public.coach_profiles where id in ${sql(coachIds)}) as "coachProfiles",
          (select count(*)::int from public.lessons where coach_profile_id in ${sql(coachIds)}) as lessons
      `
      return counts
    },
    cleanup: () => cleanupNamespace(sql, serviceClient, namespace),
    close: () => sql.end({ timeout: 1 }),
  }
}

export function createLessonImagePersonaClients(status, users) {
  const clients = { anonymous: createBrowserClient(status) }
  for (const user of users) clients[user.key] = createBrowserClient(status)
  return clients
}

export async function signInLessonImagePersonas(clients, users, password) {
  for (const user of users) {
    const { data, error } = await clients[user.key].auth.signInWithPassword({
      email: user.email,
      password,
    })
    if (error) throw error
    if (data.user?.id !== user.id) throw new Error("Persona sign-in returned the wrong namespace")
  }
}

export async function signOutLessonImagePersonas(clients) {
  for (const client of Object.values(clients)) await client.auth.signOut()
}

async function cleanupNamespace(sql, serviceClient, namespace) {
  const userIds = namespace.users.map((user) => user.id)
  const coachIds = [
    namespace.approvedCoachProfileId,
    namespace.pendingCoachProfileId,
    namespace.foreignCoachProfileId,
  ]
  const objectRows = await sql`
    select file_path as name from public.lesson_images where lesson_id in (
      select id from public.lessons where coach_profile_id in ${sql(coachIds)}
    )
    union
    select object_name as name from public.lesson_image_upload_intents where lesson_id in (
      select id from public.lessons where coach_profile_id in ${sql(coachIds)}
    )
  `
  if (objectRows.length > 0) {
    const { error } = await serviceClient.storage
      .from("lesson-images")
      .remove(objectRows.map((row) => row.name))
    if (error) throw error
  }
  await sql`delete from public.lessons where coach_profile_id in ${sql(coachIds)}`
  await sql`delete from public.coach_profiles where id in ${sql(coachIds)}`
  await sql`delete from public.profiles where id in ${sql(userIds)}`
  for (const user of namespace.users) {
    const { error } = await serviceClient.auth.admin.deleteUser(user.id)
    if (error && error.status !== 404) throw error
  }
}

function createBrowserClient(status) {
  return createClient(status.apiUrl, status.anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

function findUser(namespace, key) {
  const user = namespace.users.find((candidate) => candidate.key === key)
  if (!user) throw new Error(`Missing lesson-image persona: ${key}`)
  return user
}

async function readSportId(sql) {
  const [sport] = await sql`select id::text from public.sports where is_active order by id limit 1`
  if (!sport?.id) throw new Error("Lesson-image fixture requires an active sport")
  return sport.id
}
