import assert from "node:assert/strict"
import { appendFile, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  captureLessonImageSourceBinding,
  discoverLessonImageMigrations,
} from "./source-binding.mjs"

test("focused source binding covers every scoped source and relevant production source", async () => {
  const first = await captureLessonImageSourceBinding()
  const second = await captureLessonImageSourceBinding()
  assert.deepEqual(second, first)
  assert.ok(first.scopedFileCount >= 12)
  assert.ok(first.productionFileCount >= 28)
  assert.equal(first.files.length, first.scopedFileCount + first.productionFileCount)
  assert.match(first.aggregateSha256, /^[0-9a-f]{64}$/u)
  assert.ok(first.files.every((entry) => /^[0-9a-f]{64}$/u.test(entry.sha256)))
  const discoveredMigrations = await discoverLessonImageMigrations()
  const boundMigrations = first.files
    .map((entry) => entry.path)
    .filter((file) => file.startsWith("supabase/migrations/"))
  assert.deepEqual(boundMigrations, discoveredMigrations)
  assert.deepEqual(
    discoveredMigrations.map((file) => file.match(/supabase\/migrations\/(\d+)_/u)?.[1]),
    [...discoveredMigrations]
      .map((file) => file.match(/supabase\/migrations\/(\d+)_/u)?.[1])
      .sort(),
  )
  assert.ok(
    boundMigrations.includes(
      "supabase/migrations/20260826090000_close_lesson_image_registration_rpc_boundary.sql",
    ),
  )
})

test("execution-time lesson-image migrations bind in version order and content drift changes aggregate", async (t) => {
  const repoRoot = process.cwd()
  const baseline = await captureLessonImageSourceBinding(repoRoot)
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-lesson-image-binding-"))
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }))

  await copyBindingFixture(
    repoRoot,
    fixtureRoot,
    baseline.files.map((entry) => entry.path),
  )
  const initial = await captureLessonImageSourceBinding(fixtureRoot)
  const laterMigration = "supabase/migrations/20260826090001_add_lesson_image_future_guard.sql"
  const unrelatedMigration = "supabase/migrations/20260826090002_add_reservation_future_guard.sql"
  await writeFixtureFile(
    fixtureRoot,
    laterMigration,
    "create function future_lesson_image_guard();\n",
  )
  await writeFixtureFile(fixtureRoot, unrelatedMigration, "create function unrelated_guard();\n")

  const extended = await captureLessonImageSourceBinding(fixtureRoot)
  const discoveredMigrations = await discoverLessonImageMigrations(fixtureRoot)
  const boundMigrations = extended.files
    .map((entry) => entry.path)
    .filter((file) => file.startsWith("supabase/migrations/"))

  assert.deepEqual(boundMigrations, discoveredMigrations)
  assert.ok(boundMigrations.includes(laterMigration))
  assert.ok(!extended.files.some((entry) => entry.path === unrelatedMigration))
  assert.notEqual(extended.aggregateSha256, initial.aggregateSha256)

  await appendFile(path.join(fixtureRoot, laterMigration), "-- content drift\n")
  const drifted = await captureLessonImageSourceBinding(fixtureRoot)
  assert.notEqual(drifted.aggregateSha256, extended.aggregateSha256)
})

async function copyBindingFixture(repoRoot, fixtureRoot, files) {
  for (const file of files) {
    const destination = path.join(fixtureRoot, file)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(repoRoot, file), destination)
  }
}

async function writeFixtureFile(fixtureRoot, file, content) {
  const destination = path.join(fixtureRoot, file)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}
