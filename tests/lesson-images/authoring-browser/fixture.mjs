import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { createQaUser, writePrivateJson } from "../../lesson-authoring-browser-qa-support.mjs"
import { readGuardedLocalStatus } from "../../supabase-e2e/local-status.mjs"

const password = "LocalOnly-Task7-Authoring-42!"

export async function createAuthoringFixture(evidenceDir) {
  const status = await readGuardedLocalStatus()
  const service = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { persistSession: false },
  })
  const sql = postgres(status.dbUrl, { idle_timeout: 1, max: 1 })
  const email = `task7-lesson-images-${randomUUID()}@example.test`
  const userId = await createQaUser(service, email, password)
  const coachProfileId = randomUUID()
  let lessonId = null

  return {
    coachProfileId,
    credentials: { email, password },
    evidenceDir,
    getLessonId: () => lessonId,
    service,
    setLessonId: (value) => {
      lessonId = value
    },
    sql,
    userId,
  }
}

export async function provisionAuthoringFixture(fixture) {
  const [sport] = await fixture.sql`
    select id from public.sports where is_active order by created_at limit 1
  `
  assert.equal(typeof sport?.id, "string")
  await fixture.sql`
    insert into public.profiles (id, display_name, role, status)
    values (${fixture.userId}, 'Todo7 브라우저 지도자', 'learner', 'coach_approved')
  `
  await fixture.sql`
    insert into public.coach_profiles (id, user_id, status, service_region)
    values (${fixture.coachProfileId}, ${fixture.userId}, 'approved', '서울 강남구')
  `
  return String(sport.id)
}

export async function cleanupAuthoringFixture(fixture) {
  const lessonId = fixture.getLessonId()
  const ownedLessons = lessonId
    ? [{ id: lessonId }]
    : await fixture.sql`
        select id from public.lessons where coach_profile_id = ${fixture.coachProfileId}
      `
  for (const ownedLesson of ownedLessons) await removeLessonGraph(fixture, ownedLesson.id)
  await fixture.sql`delete from public.coach_profiles where user_id = ${fixture.userId}`
  await fixture.sql`delete from public.profiles where id = ${fixture.userId}`
  await fixture.service.auth.admin.deleteUser(fixture.userId)
  const [remaining] = await fixture.sql`
    select
      (select count(*)::integer from auth.users where id = ${fixture.userId}) as auth_count,
      (select count(*)::integer from public.coach_profiles where user_id = ${fixture.userId})
        as coach_count,
      (select count(*)::integer from public.lessons
        where coach_profile_id = ${fixture.coachProfileId}) as lesson_count,
      (select count(*)::integer from public.profiles where id = ${fixture.userId}) as profile_count
  `
  await writePrivateJson(`${fixture.evidenceDir}/cleanup.json`, {
    authRowsRemaining: remaining?.auth_count ?? -1,
    coachRowsRemaining: remaining?.coach_count ?? -1,
    lessonRowsRemaining: remaining?.lesson_count ?? -1,
    profileRowsRemaining: remaining?.profile_count ?? -1,
    preexistingNextStopped: false,
    preexistingSupabaseStopped: false,
  })
  await fixture.sql.end()
}

async function removeLessonGraph(fixture, lessonId) {
  const paths = await fixture.sql`
    select file_path from public.lesson_images where lesson_id = ${lessonId}
    union
    select object_name as file_path from public.lesson_image_upload_intents
    where lesson_id = ${lessonId}
  `
  if (paths.length > 0) {
    await fixture.service.storage.from("lesson-images").remove(paths.map((row) => row.file_path))
  }
  await fixture.sql`delete from public.lesson_image_deletion_receipts where lesson_id = ${lessonId}`
  await fixture.sql`delete from public.lesson_image_upload_intents where lesson_id = ${lessonId}`
  await fixture.sql`delete from public.lesson_images where lesson_id = ${lessonId}`
  await fixture.sql`delete from public.lessons where id = ${lessonId}`
}
