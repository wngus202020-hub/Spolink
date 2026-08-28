import assert from "node:assert/strict"
import test from "node:test"

import { existing, imageIds, queued } from "./fixtures.mjs"

const { hasBlockingLessonImageWork, lessonImageActionErrorMessage } = await import(
  "../../../components/lessons/coach-lesson-image-authoring-model.ts"
)

test("Given local image work or a stale image response, when actions are classified, then review is blocked and refresh guidance is exact", () => {
  const states = [
    [queued("queued.webp")],
    [{ ...queued("uploading.webp"), status: "uploading" }],
    [{ ...queued("failed.webp"), errorMessage: "실패", status: "failed" }],
    [existing(imageIds[0], "deleting")],
  ]
  for (const items of states) assert.equal(hasBlockingLessonImageWork(items, false), true)
  assert.equal(hasBlockingLessonImageWork([existing(imageIds[0])], true), true)
  assert.equal(hasBlockingLessonImageWork([existing(imageIds[0])], false), false)
  assert.equal(
    lessonImageActionErrorMessage({ code: "CONFLICT", status: "error", statusCode: 409 }),
    "이미지 상태가 변경되었습니다. 이 페이지를 새로 열어 다시 시도해 주세요.",
  )
})
