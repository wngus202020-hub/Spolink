import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import { pathToFileURL } from "node:url"

const workspaceUrl = pathToFileURL(`${process.cwd()}/`).href
const lessonId = "00000000-0000-4000-8000-000000000001"
const publicStorageBaseUrl = "https://public.example.test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, workspaceUrl).href, context)
    }

    return nextResolve(specifier, context)
  },
})

const [displayLessons, displayLessonMapper, publicLessonApi] = await Promise.all([
  import("../../lib/lessons/display-lessons.ts"),
  import("../../lib/lessons/display-lesson-mapper.ts"),
  import("../../lib/lessons/public-lesson-api.ts"),
])

test("Given one safe public image, when a lesson is mapped and serialized, then list keys and one-image detail remain compatible", async () => {
  // Given
  const lesson = await mapPublicLesson([readyImage("11", 0)])
  const query = publicLessonApi.parseLessonListQuery(new URLSearchParams()).query

  // When
  const list = publicLessonApi.buildLessonListResponse([lesson], query)
  const detail = publicLessonApi.buildLessonDetailResponse(lesson)

  // Then
  assert.deepEqual(Object.keys(list.data[0]).sort(), [
    "coach",
    "durationMinutes",
    "id",
    "priceAmount",
    "region",
    "sport",
    "thumbnailUrl",
    "title",
  ])
  assert.equal(list.data[0].thumbnailUrl, publicUrl("11"))
  assert.deepEqual(detail.data.images, [{ sortOrder: 0, url: publicUrl("11") }])
})

test("Given an inactive demo lesson, when it is requested through the public display selector, then anonymous lookup returns no lesson", async () => {
  // Given
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  try {
    // When
    const lesson = await displayLessons.getActiveLessonByIdForDisplay("running-mapo")

    // Then
    assert.equal(lesson, undefined)
  } finally {
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", previousPublicUrl)
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY", previousPublicKey)
  }
})

test("Given no ready images, when a public lesson is serialized, then the missing fallback remains and detail has no images", async () => {
  // Given
  const lesson = await mapPublicLesson([])
  const query = publicLessonApi.parseLessonListQuery(new URLSearchParams()).query

  // When
  const list = publicLessonApi.buildLessonListResponse([lesson], query)
  const detail = publicLessonApi.buildLessonDetailResponse(lesson)

  // Then
  assert.equal(lesson.media.kind, "missing")
  assert.equal(list.data[0].thumbnailUrl, null)
  assert.deepEqual(detail.data.images, [])
})

test("Given five ready rows in shuffled input order, when an active lesson is mapped, then the cover and detail follow sort order", async () => {
  // Given
  const imageIds = ["15", "11", "14", "12", "13"]
  const lesson = await mapPublicLesson([
    readyImage(imageIds[0], 4),
    readyImage(imageIds[1], 0),
    readyImage(imageIds[2], 3),
    readyImage(imageIds[3], 1),
    readyImage(imageIds[4], 2),
  ])
  const query = publicLessonApi.parseLessonListQuery(new URLSearchParams()).query

  // When
  const list = publicLessonApi.buildLessonListResponse([lesson], query)
  const detail = publicLessonApi.buildLessonDetailResponse(lesson)

  // Then
  assert.equal(list.data[0].thumbnailUrl, publicUrl("11"))
  assert.deepEqual(detail.data.images, [
    { sortOrder: 0, url: publicUrl("11") },
    { sortOrder: 1, url: publicUrl("12") },
    { sortOrder: 2, url: publicUrl("13") },
    { sortOrder: 3, url: publicUrl("14") },
    { sortOrder: 4, url: publicUrl("15") },
  ])
})

test("Given a deleting cover, malformed path, and non-ready row, when an active lesson is mapped, then only the next safe ready image is public", async () => {
  // Given
  const visibleImageId = "12"
  const lesson = await mapPublicLesson([
    readyImage("11", 0, { lifecycle_state: "deleting" }),
    readyImage(visibleImageId, 1),
    readyImage("13", 2, { file_path: "../private-object.webp" }),
    readyImage("14", 3, { lifecycle_state: "pending" }),
  ])
  const query = publicLessonApi.parseLessonListQuery(new URLSearchParams()).query

  // When
  const list = publicLessonApi.buildLessonListResponse([lesson], query)
  const detail = publicLessonApi.buildLessonDetailResponse(lesson)

  // Then
  assert.equal(list.data[0].thumbnailUrl, publicUrl(visibleImageId))
  assert.deepEqual(detail.data.images, [{ sortOrder: 1, url: publicUrl(visibleImageId) }])
  assert.deepEqual(Object.keys(detail.data.images[0]).sort(), ["sortOrder", "url"])
  assert.doesNotMatch(
    JSON.stringify(detail),
    /file_path|lifecycle_state|private-object|deleting|pending/iu,
  )
})

test("Given ready rows with equal sort orders, when public media is mapped, then image IDs provide stable tie order", async () => {
  // Given
  const lesson = await mapPublicLesson([readyImage("19", 0), readyImage("18", 0)])

  // When
  const detail = publicLessonApi.buildLessonDetailResponse(lesson)

  // Then
  assert.deepEqual(detail.data.images, [
    { sortOrder: 0, url: publicUrl("18") },
    { sortOrder: 0, url: publicUrl("19") },
  ])
})

async function mapPublicLesson(images) {
  return withPublicStorageEnvironment(() =>
    displayLessonMapper.mapPublicLesson(
      {
        address: null,
        cancellation_policy_summary: "예약 단계에서 환불 기준 확인",
        coach_profile_id: "00000000-0000-4000-8000-000000000002",
        description: "공개 레슨 설명",
        duration_minutes: 60,
        id: lessonId,
        place_name: "공개 코트",
        preparation: "운동화",
        price_amount: 30_000,
        region: "서울 성동구",
        sport_id: "00000000-0000-4000-8000-000000000003",
        summary: "공개 레슨 요약",
        title: "공개 레슨",
      },
      {
        coachCard: { bio: "공개 지도자 소개", career_years: 4, headline: "테니스 지도자" },
        images,
        reviews: [],
        schedules: [
          {
            capacity: 4,
            id: "00000000-0000-4000-8000-000000000004",
            is_open: true,
            lesson_id: lessonId,
            reserved_count: 1,
            starts_at: "2030-01-01T00:00:00.000Z",
          },
        ],
        sport: { id: "00000000-0000-4000-8000-000000000003", name: "테니스" },
      },
    ),
  )
}

function readyImage(idSuffix, sortOrder, overrides = {}) {
  const id = `00000000-0000-4000-8000-0000000000${idSuffix}`

  return {
    created_at: "2030-01-01T00:00:00.000Z",
    file_path: `${lessonId}/${id}.webp`,
    id,
    lesson_id: lessonId,
    lifecycle_state: "ready",
    sort_order: sortOrder,
    ...overrides,
  }
}

async function withPublicStorageEnvironment(action) {
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousPublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = publicStorageBaseUrl
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"

  try {
    return await action()
  } finally {
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", previousPublicUrl)
    restoreEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY", previousPublicKey)
  }
}

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

function publicUrl(idSuffix) {
  return `${publicStorageBaseUrl}/storage/v1/object/public/lesson-images/${lessonId}/00000000-0000-4000-8000-0000000000${idSuffix}.webp`
}
