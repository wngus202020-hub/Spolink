import assert from "node:assert/strict"
import test from "node:test"

import { dependencies, imageIds, intent, isUploading, lessonId, queued } from "./fixtures.mjs"

const { uploadPendingLessonImages } = await import(
  "../../../components/lessons/coach-lesson-image-authoring-model.ts"
)

test("Given three selected files, when upload runs, then intent, provider upload, and registration are strictly sequential", async () => {
  const calls = []
  const snapshots = []
  let index = 0
  const items = [queued("first.webp"), queued("second.webp"), queued("third.webp")]

  const result = await uploadPendingLessonImages({
    dependencies: dependencies({
      issueIntent: async (_lessonId, file) => {
        const current = index
        calls.push(`intent:${file.name}`)
        return intent(current)
      },
      register: async (_lessonId, uploadIntent) => {
        const current = index
        calls.push(`register:${uploadIntent.objectName}`)
        index += 1
        return {
          data: {
            images: imageIds.slice(0, current + 1).map((id, imageIndex) => ({
              id,
              objectName: `${lessonId}/${imageIndex}.webp`,
              sortOrder: imageIndex,
            })),
          },
          status: "success",
        }
      },
      upload: async (uploadIntent, file) => {
        calls.push(`upload:${file.name}:${uploadIntent.objectName}`)
        return { status: "success" }
      },
    }),
    items,
    lessonId,
    onItemsChange: (nextItems) => snapshots.push(nextItems),
  })

  assert.equal(result.status, "success")
  assert.deepEqual(calls, [
    "intent:first.webp",
    `upload:first.webp:${lessonId}/0.webp`,
    `register:${lessonId}/0.webp`,
    "intent:second.webp",
    `upload:second.webp:${lessonId}/1.webp`,
    `register:${lessonId}/1.webp`,
    "intent:third.webp",
    `upload:third.webp:${lessonId}/2.webp`,
    `register:${lessonId}/2.webp`,
  ])
  assert.deepEqual(
    result.items.map((item) => item.kind),
    ["existing", "existing", "existing"],
  )
  assert.equal(
    snapshots.some((snapshot) => snapshot.some(isUploading)),
    true,
  )
})
