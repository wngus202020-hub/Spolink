import assert from "node:assert/strict"
import { copyFile, stat } from "node:fs/promises"
import path from "node:path"

export async function publishCanonicalArtifacts(evidenceDir) {
  const run2 = path.join(evidenceDir, "run-2")
  const copies = [
    [
      "authoring/task-10-authoring-selection-desktop.png",
      "task-10-lesson-image-upload-desktop.png",
    ],
    [
      "authoring/task-10-authoring-failure-retry-tablet.png",
      "task-10-lesson-image-upload-tablet.png",
    ],
    ["public/public-gallery-five-mobile.png", "task-10-lesson-image-upload-mobile.png"],
    ["authoring/task-7-lesson-image-upload.zip", "task-10-authoring-trace.zip"],
    ["public/public-gallery-trace.zip", "task-10-public-trace.zip"],
  ]
  for (const state of ["five", "zero", "one", "broken"]) {
    for (const viewport of ["desktop", "tablet", "mobile", "narrow"]) {
      copies.push([
        `public/public-gallery-${state}-${viewport}.png`,
        `canonical-public-${state}-${viewport}.png`,
      ])
    }
  }
  for (const [source, target] of copies) {
    await copyFile(path.join(run2, source), path.join(evidenceDir, target))
    assert.ok((await stat(path.join(evidenceDir, target))).size > 0)
  }
}
