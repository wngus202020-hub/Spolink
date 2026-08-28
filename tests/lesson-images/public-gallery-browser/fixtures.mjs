import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { GALLERY_STATES } from "./config.mjs"

export function createFixtureState() {
  return {
    coachId: null,
    coachProfileId: randomUUID(),
    lessonIds: Object.fromEntries(Object.keys(GALLERY_STATES).map((name) => [name, randomUUID()])),
    storagePaths: [],
  }
}

export async function createGalleryFixtures({ fixture, runId, service, sql }) {
  const sport = (
    await sql`select id, name from public.sports where is_active and name = '축구' limit 1`
  )[0]
  assert.equal(sport?.name, "축구")
  const user = await service.auth.admin.createUser({
    email: `gallery-${runId}@example.test`,
    email_confirm: true,
    password: "Gallery-Local-42!",
  })
  assert.ifError(user.error)
  fixture.coachId = user.data.user?.id
  assert.equal(typeof fixture.coachId, "string")
  await sql`insert into public.profiles (id, display_name, role, status) values (${fixture.coachId}, '공개 갤러리 검증 지도자', 'learner', 'coach_approved')`
  await sql`insert into public.coach_profiles (id, user_id, status, service_region, career_years, headline, bio) values (${fixture.coachProfileId}, ${fixture.coachId}, 'approved', '서울 강남구', 8, '축구 전문 지도자', '공개 갤러리 검증용 지도자 소개입니다.')`
  for (const [key, state] of Object.entries(GALLERY_STATES)) {
    const lessonId = fixture.lessonIds[key]
    await sql`insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, summary, region, duration_minutes, price_amount, capacity, place_name, preparation) values (${lessonId}, ${fixture.coachProfileId}, ${sport.id}, 'active', ${state.title}, '이미지 순서와 실제 수업 모습을 확인하는 공개 갤러리 검증 레슨입니다.', '수업 이미지를 순서대로 확인해요.', '서울 강남구', 60, 50000, 4, 'SPOLINK 공개 경기장', '운동복과 운동화를 준비해요.')`
    await sql`insert into public.lesson_schedules (lesson_id, starts_at, ends_at, capacity, reserved_count, is_open) values (${lessonId}, now() + interval '3 days', now() + interval '3 days 1 hour', 4, 0, true)`
  }
  const bytes = await Promise.all(
    ["lesson-tennis.webp", "lesson-pilates.webp", "lesson-running.webp"].map((name) =>
      readFile(`public/images/${name}`),
    ),
  )
  for (let index = 0; index < 5; index += 1) {
    await addImage({
      bytes: bytes[index % bytes.length],
      fixture,
      lessonId: fixture.lessonIds.five,
      service,
      sortOrder: index,
      sql,
    })
  }
  await addImage({
    bytes: bytes[0],
    fixture,
    lessonId: fixture.lessonIds.one,
    service,
    sortOrder: 0,
    sql,
  })
  await addImage({
    bytes: bytes[0],
    fixture,
    lessonId: fixture.lessonIds.broken,
    service,
    sortOrder: 0,
    sql,
    upload: false,
  })
}

async function addImage({ bytes, fixture, lessonId, service, sortOrder, sql, upload = true }) {
  const filePath = `${lessonId}/${randomUUID()}.webp`
  fixture.storagePaths.push(filePath)
  if (upload) {
    const result = await service.storage
      .from("lesson-images")
      .upload(filePath, bytes, { contentType: "image/webp", upsert: false })
    assert.ifError(result.error)
  }
  await sql`insert into public.lesson_images (lesson_id, file_path, sort_order, lifecycle_state) values (${lessonId}, ${filePath}, ${sortOrder}, 'ready')`
}
