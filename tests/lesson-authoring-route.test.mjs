import assert from "node:assert/strict"
import test from "node:test"

await import("./profile-api/fixtures.mjs")

const { createCreateLessonRouteHandler, createUpdateScheduleRouteHandler } = await import(
  "../lib/lessons/authoring-route-handlers.ts"
)

const lessonId = "00000000-0000-4000-8000-000000000201"
const scheduleId = "00000000-0000-4000-8000-000000000301"

test("Given an unauthenticated actor, when a valid lesson draft is posted, then the route returns no-store 401", async () => {
  // Given
  let writeCount = 0
  const handler = createCreateLessonRouteHandler({
    createWorkflowDependencies: async () => ({
      closeSchedule: async () => ({ data: null, errorCode: null }),
      createLesson: async () => {
        writeCount += 1
        return { data: null, errorCode: null }
      },
      createSchedule: async () => ({ data: null, errorCode: null }),
      getActorAccess: async () => ({ kind: "unauthenticated" }),
      transitionLesson: async () => ({ data: null, errorCode: null }),
      updateLesson: async () => ({ data: null, errorCode: null }),
      updateSchedule: async () => ({ data: null, errorCode: null }),
    }),
    isSupabaseConfigured: () => true,
  })

  // When
  const response = await handler(jsonRequest("/api/lessons", validDraft()))

  // Then
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(writeCount, 0)
})

test("Given client-owned status and a valid session, when a draft is posted, then parsing rejects it before auth", async () => {
  // Given
  let dependencyCount = 0
  const handler = createCreateLessonRouteHandler({
    createWorkflowDependencies: async () => {
      dependencyCount += 1
      throw new Error("dependencies must not be created")
    },
    isSupabaseConfigured: () => true,
  })

  // When
  const response = await handler(
    jsonRequest("/api/lessons", { ...validDraft(), coachProfileId: lessonId, status: "active" }),
  )

  // Then
  assert.equal(response.status, 422)
  assert.equal(dependencyCount, 0)
})

test("Given nested lesson and schedule ids, when an update is routed, then both ids reach persistence", async () => {
  // Given
  const received = []
  const row = scheduleRow()
  const handler = createUpdateScheduleRouteHandler({
    createWorkflowDependencies: async () => ({
      closeSchedule: async () => ({ data: null, errorCode: null }),
      createLesson: async () => ({ data: null, errorCode: null }),
      createSchedule: async () => ({ data: null, errorCode: null }),
      getActorAccess: async () => ({ coachProfileId: lessonId, kind: "approved_coach" }),
      transitionLesson: async () => ({ data: null, errorCode: null }),
      updateLesson: async () => ({ data: null, errorCode: null }),
      updateSchedule: async (receivedLessonId, receivedScheduleId) => {
        received.push(receivedLessonId, receivedScheduleId)
        return { data: row, errorCode: null }
      },
    }),
    isSupabaseConfigured: () => true,
  })

  // When
  const response = await handler(
    jsonRequest(`/api/lessons/${lessonId}/schedules/${scheduleId}`, {
      capacity: 4,
      endsAt: "2026-08-20T03:00:00+09:00",
      expectedUpdatedAt: row.updated_at,
      startsAt: "2026-08-20T02:00:00+09:00",
    }),
    { params: Promise.resolve({ lessonId, scheduleId }) },
  )

  // Then
  assert.equal(response.status, 200)
  assert.deepEqual(received, [lessonId, scheduleId])
})

function jsonRequest(path, body) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
    method: "POST",
  })
}

function validDraft() {
  return {
    capacity: 4,
    description: "초보자를 위한 안전한 테니스 수업입니다.",
    durationMinutes: 60,
    priceAmount: 50000,
    region: "서울 강남구",
    sportId: "00000000-0000-4000-8000-000000000101",
    title: "테니스 입문 레슨",
  }
}

function scheduleRow() {
  return {
    capacity: 4,
    created_at: "2026-08-14T05:00:00.000Z",
    ends_at: "2026-08-19T18:00:00.000Z",
    id: scheduleId,
    is_open: true,
    lesson_id: lessonId,
    reserved_count: 0,
    starts_at: "2026-08-19T17:00:00.000Z",
    updated_at: "2026-08-14T05:00:00.000Z",
  }
}
