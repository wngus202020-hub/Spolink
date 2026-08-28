import assert from "node:assert/strict"
import test from "node:test"

import { dependencies, imageIds, intent, lessonId, queued, summary } from "./fixtures.mjs"

const { uploadPendingLessonImages } = await import(
  "../../../components/lessons/coach-lesson-image-authoring-model.ts"
)

test("Given image two fails, when image-only retry runs, then image one is retained and only files two and three upload", async () => {
  const calls = []
  let shouldFailSecond = true
  const initialItems = [queued("first.webp"), queued("second.webp"), queued("third.webp")]
  const deps = dependencies({
    issueIntent: async (_lessonId, file) => {
      calls.push(`intent:${file.name}`)
      const fileIndex = ["first.webp", "second.webp", "third.webp"].indexOf(file.name)
      return intent(fileIndex)
    },
    register: async (_lessonId, uploadIntent) => {
      calls.push(`register:${uploadIntent.objectName}`)
      const fileIndex = Number(uploadIntent.objectName.split("/").at(-1)?.split(".")[0])
      return {
        data: {
          images: imageIds.slice(0, fileIndex + 1).map((id, imageIndex) => ({
            id,
            objectName: `${lessonId}/${imageIndex}.webp`,
            sortOrder: imageIndex,
          })),
        },
        status: "success",
      }
    },
    upload: async (_uploadIntent, file) => {
      calls.push(`upload:${file.name}`)
      if (file.name === "second.webp" && shouldFailSecond) {
        shouldFailSecond = false
        return { code: "UNAVAILABLE", status: "error", statusCode: 503 }
      }
      return { status: "success" }
    },
  })

  const failed = await uploadPendingLessonImages({
    dependencies: deps,
    items: initialItems,
    lessonId,
    onItemsChange: () => {},
  })

  assert.equal(failed.status, "error")
  assert.deepEqual(failed.items.map(summary), [
    "existing:registered",
    "queued:failed",
    "queued:queued",
  ])
  assert.equal(failed.items[1].file, initialItems[1].file)
  assert.equal(failed.items[2].file, initialItems[2].file)

  calls.length = 0
  const retried = await uploadPendingLessonImages({
    dependencies: deps,
    items: failed.items,
    lessonId,
    onItemsChange: () => {},
  })

  assert.equal(retried.status, "success")
  assert.deepEqual(
    calls.filter((call) => call.startsWith("intent:")),
    ["intent:third.webp"],
  )
  assert.equal(
    calls.some((call) => call.includes("first.webp")),
    false,
  )
})

test("Given register compensation removed the upload, when retry runs, then it keeps the file and completed image while starting a fresh upload", async () => {
  const calls = []
  const file = new File(["retry"], "retry.webp", { type: "image/webp" })
  const completed = {
    id: imageIds[0],
    kind: "existing",
    objectName: `${lessonId}/completed.webp`,
    previewUrl: "/public/completed.webp",
    status: "registered",
  }
  const queuedImage = {
    file,
    id: "queued:retry.webp",
    kind: "queued",
    status: "queued",
  }
  let intentCount = 0
  let registerCount = 0
  const deps = dependencies({
    issueIntent: async () => {
      const result = intent(intentCount + 1)
      intentCount += 1
      calls.push(`intent:${result.data.intentId}`)
      return result
    },
    register: async (_lessonId, uploadIntent) => {
      registerCount += 1
      calls.push(`register:${uploadIntent.intentId}`)
      if (registerCount === 1) {
        return { code: "UNAVAILABLE", status: "error", statusCode: 503 }
      }
      return {
        data: {
          images: [
            { id: imageIds[0], objectName: completed.objectName, sortOrder: 0 },
            { id: imageIds[1], objectName: uploadIntent.objectName, sortOrder: 1 },
          ],
        },
        status: "success",
      }
    },
    upload: async (uploadIntent, uploadedFile) => {
      calls.push(`upload:${uploadIntent.intentId}`)
      assert.equal(uploadedFile, file)
      return { status: "success" }
    },
  })

  const failed = await uploadPendingLessonImages({
    dependencies: deps,
    items: [completed, queuedImage],
    lessonId,
    onItemsChange: () => {},
  })

  assert.equal(failed.status, "error")
  assert.equal(failed.items[0], completed)
  assert.equal(failed.items[1].file, file)
  assert.equal(failed.items[1].uploadStage, "restart")
  assert.equal(failed.items[1].uploadIntent, undefined)

  calls.length = 0
  const retried = await uploadPendingLessonImages({
    dependencies: deps,
    items: failed.items,
    lessonId,
    onItemsChange: () => {},
  })

  assert.equal(retried.status, "success")
  assert.equal(retried.items[0], completed)
  assert.deepEqual(calls, [
    `intent:${intent(2).data.intentId}`,
    `upload:${intent(2).data.intentId}`,
    `register:${intent(2).data.intentId}`,
  ])
})
