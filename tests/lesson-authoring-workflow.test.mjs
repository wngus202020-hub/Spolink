import assert from "node:assert/strict"
import test from "node:test"

import "./profile-api/fixtures.mjs"

const coachProfileId = "00000000-0000-4000-8000-000000000101"

test("Given a pending coach, when a lesson draft write is requested, then authorization fails before persistence", async () => {
  // Given
  const workflow = await loadWorkflow()
  let writeCount = 0
  const dependencies = {
    createLesson: async () => {
      writeCount += 1
      return { data: null, errorCode: null }
    },
    getActorAccess: async () => ({
      coachProfileId,
      kind: "pending_coach",
    }),
  }

  // When
  const result = await workflow.runCreateLessonDraft(validLessonDraft(), dependencies)

  // Then
  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "COACH_NOT_APPROVED")
  assert.equal(result.error.statusCode, 403)
  assert.equal(writeCount, 0)
})

test("Given a coach actor, when an admin review action is requested, then it fails before persistence", async () => {
  // Given
  const workflow = await loadWorkflow()
  let transitionCount = 0
  const dependencies = {
    getActorAccess: async () => ({ coachProfileId, kind: "approved_coach" }),
    transitionLesson: async () => {
      transitionCount += 1
      return { data: null, errorCode: null }
    },
  }

  // When
  const result = await workflow.runTransitionLesson(
    "00000000-0000-4000-8000-000000000201",
    {
      action: "approve",
      expectedUpdatedAt: "2026-08-14T05:00:00.000Z",
      reason: null,
    },
    dependencies,
  )

  // Then
  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "FORBIDDEN")
  assert.equal(transitionCount, 0)
})

test("Given a confirmed reservation conflict, when its schedule is edited, then the workflow returns 409", async () => {
  // Given
  const workflow = await loadWorkflow()
  const dependencies = {
    getActorAccess: async () => ({ coachProfileId, kind: "approved_coach" }),
    updateSchedule: async () => ({
      data: null,
      errorCode: "SCHEDULE_HAS_CONFIRMED_RESERVATION",
    }),
  }

  // When
  const result = await workflow.runUpdateLessonSchedule(
    "00000000-0000-4000-8000-000000000201",
    "00000000-0000-4000-8000-000000000301",
    {
      capacity: 4,
      endsAt: "2026-08-20T03:00:00.000Z",
      expectedUpdatedAt: "2026-08-14T05:00:00.000Z",
      startsAt: "2026-08-20T02:00:00.000Z",
    },
    dependencies,
  )

  // Then
  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "SCHEDULE_HAS_CONFIRMED_RESERVATION")
  assert.equal(result.error.statusCode, 409)
})

test("Given a confirmed reservation conflict, when a schedule update is requested, then a typed 409 is returned", async () => {
  // Given
  const workflow = await import("../lib/lessons/authoring-workflow.ts")
  const dependencies = {
    getActorAccess: async () => ({ coachProfileId, kind: "approved_coach" }),
    updateSchedule: async () => ({
      data: null,
      errorCode: "SCHEDULE_HAS_CONFIRMED_RESERVATION",
    }),
  }

  // When
  const result = await workflow.runUpdateLessonSchedule(
    "00000000-0000-4000-8000-000000000104",
    "00000000-0000-4000-8000-000000000103",
    {
      capacity: 4,
      endsAt: "2026-08-20T11:00:00+09:00",
      expectedUpdatedAt: "2026-08-14T00:00:00.000Z",
      startsAt: "2026-08-20T10:00:00+09:00",
    },
    dependencies,
  )

  // Then
  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "SCHEDULE_HAS_CONFIRMED_RESERVATION")
  assert.equal(result.error.statusCode, 409)
})

test("Given a database exclusion conflict, when a schedule is created, then a typed 409 is returned", async () => {
  const workflow = await import("../lib/lessons/authoring-workflow.ts")
  const dependencies = {
    getActorAccess: async () => ({ coachProfileId, kind: "approved_coach" }),
    createSchedule: async () => ({ data: null, errorCode: "23P01" }),
  }

  const result = await workflow.runCreateLessonSchedule(
    "lesson-id",
    {
      capacity: 4,
      endsAt: "2026-08-21T04:00:00.000Z",
      startsAt: "2026-08-21T03:00:00.000Z",
    },
    dependencies,
  )

  assert.equal(result.status, "failure")
  assert.equal(result.error.code, "SCHEDULE_OVERLAP_CONFLICT")
  assert.equal(result.error.statusCode, 409)
})

async function loadWorkflow() {
  try {
    return await import("../lib/lessons/authoring-workflow")
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_MODULE_NOT_FOUND" ||
      !("url" in error) ||
      typeof error.url !== "string" ||
      !error.url.endsWith("/authoring-workflow.ts")
    ) {
      throw error
    }

    return {
      runCreateLessonDraft: async () => ({
        error: { code: "NOT_IMPLEMENTED", statusCode: 501 },
        status: "failure",
      }),
    }
  }
}

function validLessonDraft() {
  return {
    capacity: 6,
    cancellationPolicySummary: "수업 24시간 전까지 취소 정책이 적용됩니다.",
    description: "테니스 기본 자세와 안전한 랠리를 배웁니다.",
    durationMinutes: 60,
    placeName: "SPOLINK 테니스장",
    priceAmount: 50000,
    preparation: "운동화와 물을 준비해 주세요.",
    region: "서울 강남구",
    sportId: "00000000-0000-4000-8000-000000000102",
    summary: "입문자를 위한 안전한 테니스 수업",
    title: "테니스 입문 클래스",
  }
}
