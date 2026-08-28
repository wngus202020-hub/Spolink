import assert from "node:assert/strict"
import test from "node:test"

import { existing, lessonId, queued, validDraft } from "./authoring-model/fixtures.mjs"

const { hasBlockingLessonImageWork, lessonImageActionErrorMessage } = await import(
  "../../components/lessons/coach-lesson-image-authoring-model.ts"
)
const { runNewLessonSubmission } = await import("../../components/lessons/coach-lesson-new-flow.ts")

const draftData = (updatedAt) => ({
  id: lessonId,
  status: "draft",
  title: validDraft.title,
  updatedAt,
})

test("Given a saved draft after partial upload, when images retry, then the draft is updated once and redirect waits for success", async () => {
  let createCalls = 0
  let updateCalls = 0
  const first = await runNewLessonSubmission({
    createDraft: async () => {
      createCalls += 1
      return { data: draftData("2026-08-26T12:00:00.000Z"), status: "success" }
    },
    draft: validDraft,
    draftId: null,
    updateDraft: async () => assert.fail("a new lesson must create its draft"),
    uploadImages: async () => false,
    version: null,
  })

  assert.deepEqual(first, {
    draftId: lessonId,
    status: "image_failure",
    updatedAt: "2026-08-26T12:00:00.000Z",
  })

  const retry = await runNewLessonSubmission({
    createDraft: async () => assert.fail("retry must reuse the saved draft"),
    draft: validDraft,
    draftId: first.draftId,
    updateDraft: async (updatedLessonId, input) => {
      updateCalls += 1
      assert.equal(updatedLessonId, lessonId)
      assert.equal(input.expectedUpdatedAt, first.updatedAt)
      return { data: draftData("2026-08-26T12:01:00.000Z"), status: "success" }
    },
    uploadImages: async (updatedLessonId) => updatedLessonId === lessonId,
    version: first.updatedAt,
  })

  assert.equal(createCalls, 1)
  assert.equal(updateCalls, 1)
  assert.equal(retry.status, "success")
  assert.equal(retry.redirectHref, `/coach/lessons/${lessonId}/edit`)
})

test("Given a saved draft without its version, when retry starts, then no write or upload occurs", async () => {
  let sideEffects = 0
  const result = await runNewLessonSubmission({
    createDraft: async () => {
      sideEffects += 1
      return { data: draftData("unused"), status: "success" }
    },
    draft: validDraft,
    draftId: lessonId,
    updateDraft: async () => {
      sideEffects += 1
      return { data: draftData("unused"), status: "success" }
    },
    uploadImages: async () => {
      sideEffects += 1
      return true
    },
    version: null,
  })

  assert.equal(result.status, "draft_failure")
  assert.equal(result.statusCode, 409)
  assert.equal(sideEffects, 0)
})

test("Given queued, failed, deleting, or active-intent image work, when review eligibility is checked, then it remains blocked", () => {
  assert.equal(hasBlockingLessonImageWork([queued("queued.webp")], false), true)
  assert.equal(
    hasBlockingLessonImageWork([{ ...queued("failed.webp"), status: "failed" }], false),
    true,
  )
  assert.equal(hasBlockingLessonImageWork([existing(lessonId, "deleting")], false), true)
  assert.equal(hasBlockingLessonImageWork([existing(lessonId)], true), true)
  assert.equal(hasBlockingLessonImageWork([existing(lessonId)], false), false)
  assert.equal(
    lessonImageActionErrorMessage({ code: "CONFLICT", status: "error", statusCode: 409 }),
    "이미지 상태가 변경되었습니다. 이 페이지를 새로 열어 다시 시도해 주세요.",
  )
})
