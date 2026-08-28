import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { captureLessonImageSourceBinding } from "../source-binding.mjs"

const SPLIT_DIRECTORIES = [
  "tests/supabase-e2e/lesson-images/live",
  "tests/supabase-e2e/lesson-images/runtime",
]

export async function captureSplitLessonImageSourceBinding(repoRoot = process.cwd()) {
  const base = await captureLessonImageSourceBinding(repoRoot)
  const splitFiles = (
    await Promise.all(
      SPLIT_DIRECTORIES.map(async (directory) =>
        (
          await readdir(path.join(repoRoot, directory))
        )
          .filter((name) => name.endsWith(".mjs"))
          .map((name) => `${directory}/${name}`),
      ),
    )
  ).flat()
  const splitEntries = await Promise.all(
    splitFiles.map(async (file) => ({
      path: file,
      sha256: sha256(await readFile(path.join(repoRoot, file))),
    })),
  )
  const files = [...base.files, ...splitEntries].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  return {
    ...base,
    aggregateSha256: sha256(files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join("")),
    files,
    scopedFileCount: base.scopedFileCount + splitEntries.length,
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
