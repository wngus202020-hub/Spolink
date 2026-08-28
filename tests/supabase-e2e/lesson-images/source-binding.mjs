import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const PRODUCTION_SOURCE_FILES = [
  "app/api/lessons/[lessonId]/images/[imageId]/route.ts",
  "app/api/lessons/[lessonId]/images/order/route.ts",
  "app/api/lessons/[lessonId]/images/route.ts",
  "app/api/lessons/[lessonId]/images/upload-intents/route.ts",
  "app/api/lessons/[lessonId]/route.ts",
  "app/api/lessons/[lessonId]/status/route.ts",
  "app/api/lessons/route.ts",
  "lib/lessons/authoring-contract.ts",
  "lib/lessons/authoring-repository.ts",
  "lib/lessons/authoring-route-handlers.ts",
  "lib/lessons/authoring-workflow.ts",
  "lib/lessons/display-lesson-mapper.ts",
  "lib/lessons/display-lessons.ts",
  "lib/lessons/lesson-image-client.ts",
  "lib/lessons/lesson-image-contract.ts",
  "lib/lessons/lesson-image-default-dependencies.ts",
  "lib/lessons/lesson-image-repository-errors.ts",
  "lib/lessons/lesson-image-repository.ts",
  "lib/lessons/lesson-image-route-handlers.ts",
  "lib/lessons/lesson-image-storage-repository.ts",
  "lib/lessons/lesson-image-types.ts",
  "lib/lessons/lesson-image-workflow.ts",
  "lib/lessons/public-lesson-api.ts",
  "lib/storage/lesson-image-validation.ts",
  "lib/storage/lesson-images.ts",
  "lib/supabase/database.types.ts",
  "next.config.ts",
]

const LESSON_IMAGE_MIGRATION_FILENAME = /^(\d+)_(?:.+_)?lesson[_-]images?(?:[_-].+)?\.sql$/u

export async function discoverLessonImageMigrations(repoRoot = process.cwd()) {
  const migrationRoot = path.join(repoRoot, "supabase/migrations")
  const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && LESSON_IMAGE_MIGRATION_FILENAME.test(entry.name))
    .map((entry) => ({ name: entry.name, version: migrationVersion(entry.name) }))
    .sort((left, right) => {
      const versionOrder = compareMigrationVersions(left.version, right.version)
      return versionOrder || left.name.localeCompare(right.name)
    })
  return migrations.map(({ name }) => `supabase/migrations/${name}`)
}

export async function captureLessonImageSourceBinding(repoRoot = process.cwd()) {
  const lessonImageRoot = path.join(repoRoot, "tests/supabase-e2e/lesson-images")
  const scopedFiles = (await readdir(lessonImageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => `tests/supabase-e2e/lesson-images/${entry.name}`)
  scopedFiles.push("tests/supabase-e2e/lesson-images.test.mjs")
  const lessonImageMigrations = await discoverLessonImageMigrations(repoRoot)
  const files = [
    ...new Set([...scopedFiles, ...PRODUCTION_SOURCE_FILES, ...lessonImageMigrations]),
  ].sort()
  const entries = await Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: sha256(await readFile(path.join(repoRoot, file))),
    })),
  )
  return {
    aggregateSha256: sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join("")),
    files: entries,
    productionFileCount: PRODUCTION_SOURCE_FILES.length + lessonImageMigrations.length,
    scopedFileCount: scopedFiles.length,
  }
}

function migrationVersion(name) {
  return LESSON_IMAGE_MIGRATION_FILENAME.exec(name)?.[1] ?? ""
}

function compareMigrationVersions(left, right) {
  return left.length - right.length || left.localeCompare(right)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
