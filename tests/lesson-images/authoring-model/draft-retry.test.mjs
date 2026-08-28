import assert from "node:assert/strict"
import test from "node:test"

import { lessonId, validDraft } from "./fixtures.mjs"

const { runNewLessonSubmission } = await import(
  "../../../components/lessons/coach-lesson-new-flow.ts"
)

test("Given a new draft with partial image failure, when images retry, then exactly one draft exists and redirect waits for full success", async () => {
  let createCalls = 0
  let releaseUpload
  const uploadGate = new Promise((resolve) => {
    releaseUpload = resolve
  })
  const first = await runNewLessonSubmission({
    createDraft: async () => {
      createCalls += 1
      return {
        data: {
          id: lessonId,
          status: "draft",
          title: "테스트 레슨",
          updatedAt: "2026-08-26T12:00:00.000Z",
        },
        status: "success",
      }
    },
    draft: validDraft,
    draftId: null,
    updateDraft: async () => assert.fail("new submit must not patch before draft creation"),
    uploadImages: async () => false,
    version: null,
  })

  assert.equal(first.status, "image_failure")
  assert.equal(first.draftId, lessonId)
  assert.equal(createCalls, 1)

  let settled = false
  const retry = runNewLessonSubmission({
    createDraft: async () => {
      createCalls += 1
      return assert.fail("saved draft must not be created again")
    },
    draft: validDraft,
    draftId: first.draftId,
    updateDraft: async () => ({
      data: {
        id: lessonId,
        status: "draft",
        title: "테스트 레슨",
        updatedAt: "2026-08-26T12:01:00.000Z",
      },
      status: "success",
    }),
    uploadImages: async () => {
      await uploadGate
      return true
    },
    version: first.updatedAt,
  }).then((result) => {
    settled = true
    return result
  })
  await Promise.resolve()
  assert.equal(settled, false)
  releaseUpload()
  const completed = await retry

  assert.equal(createCalls, 1)
  assert.equal(completed.status, "success")
  assert.equal(completed.redirectHref, `/coach/lessons/${lessonId}/edit`)
})
