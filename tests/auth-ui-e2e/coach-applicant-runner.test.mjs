import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { hardenCoachApplicantArtifactRoots } from "./coach-applicant-artifacts.mjs"
import { resolveCoachApplicantEvidencePaths } from "./run-coach-applicant.mjs"

test("certification applicant and admin flows run under one owned lifecycle with private artifacts", async () => {
  const [source, entrypoint] = await Promise.all([
    readFile("tests/auth-ui-e2e/run-coach-applicant.mjs", "utf8"),
    readFile("tests/auth-ui-e2e/run-coach-certification.mjs", "utf8"),
  ])

  assert.equal(source.match(/withConfiguredAuthMode\(/gu)?.length, 1)
  assert.match(source, /admin-coach-review\.spec\.ts/u)
  assert.match(source, /coach-apply\.spec\.ts/u)
  assert.match(source, /coach-application-status\.spec\.ts/u)
  assert.match(source, /--project=tablet-chromium/u)
  assert.match(source, /failureDetails/u)
  assert.match(source, /redactFailure/u)
  assert.match(source, /cleanupReceiptPath/u)
  assert.match(source, /evidencePaths/u)
  assert.match(source, /SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE/u)
  for (const point of [
    "after-config",
    "after-next-ready",
    "after-upload",
    "after-submit",
    "after-review",
  ]) {
    assert.match(source, new RegExp(point, "u"))
  }
  assert.match(entrypoint, /runCoachCertification/u)
  assert.doesNotMatch(source, /process\.umask|restrictCoachApplicantArtifactMode/u)
  assert.doesNotMatch(source, /setTimeout|sleep|retry/iu)
})

test("certification browser failure points are exercised after each persisted phase", async () => {
  const [apply, status, admin] = await Promise.all([
    readFile("tests/auth-ui-e2e/coach-apply.spec.ts", "utf8"),
    readFile("tests/auth-ui-e2e/coach-application-status.spec.ts", "utf8"),
    readFile("tests/auth-ui-e2e/admin-coach-review.spec.ts", "utf8"),
  ])

  assert.match(apply, /injectCoachCertificationFailure\("after-upload"\)/u)
  assert.match(status, /injectCoachCertificationFailure\("after-submit"\)/u)
  assert.match(admin, /injectCoachCertificationFailure\("after-review"\)/u)
})

test("applicant evidence roots recursively harden pre-existing nested artifacts", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-artifacts-"))
  const publishedRoot = path.join(temporaryDirectory, "published")
  const nestedDirectory = path.join(publishedRoot, "playwright", "screenshots")
  const summaryPath = path.join(publishedRoot, "summary.json")
  const screenshotPath = path.join(nestedDirectory, "applicant-desktop.png")
  try {
    await mkdir(nestedDirectory, { recursive: true })
    await writeFile(summaryPath, "summary")
    await writeFile(screenshotPath, "screenshot")
    await chmod(publishedRoot, 0o755)
    await chmod(path.join(publishedRoot, "playwright"), 0o755)
    await chmod(nestedDirectory, 0o755)
    await chmod(summaryPath, 0o644)
    await chmod(screenshotPath, 0o644)

    await hardenCoachApplicantArtifactRoots([publishedRoot])

    for (const directoryPath of [
      publishedRoot,
      path.join(publishedRoot, "playwright"),
      nestedDirectory,
    ]) {
      assert.equal((await stat(directoryPath)).mode & 0o777, 0o700)
    }
    for (const filePath of [summaryPath, screenshotPath]) {
      assert.equal((await stat(filePath)).mode & 0o777, 0o600)
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test("applicant runner rejects CLI output traversal before returning publish paths", async () => {
  const repoRoot = await createEvidenceRepo()
  try {
    const runnerPath = path.resolve("tests/auth-ui-e2e/run-coach-applicant.mjs")
    const result = spawnSync(
      process.execPath,
      [runnerPath, ".omo/evidence/../escaped-summary.json"],
      { cwd: repoRoot, encoding: "utf8" },
    )

    assert.equal(result.status, 1)
    assert.match(result.stderr, /must not escape \.omo\/evidence/u)
    await assert.rejects(stat(path.join(repoRoot, ".omo/escaped-summary.json")), /ENOENT/u)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("applicant runner rejects a symlink output file", async () => {
  const repoRoot = await createEvidenceRepo()
  const outsideFile = path.join(repoRoot, "outside.json")
  const outputPath = path.join(repoRoot, ".omo/evidence/summary.json")
  try {
    await writeFile(outsideFile, "untouched")
    await symlink(outsideFile, outputPath)
    await assert.rejects(resolveCoachApplicantEvidencePaths({ outputPath, repoRoot }), /real file/u)
    assert.equal(await readFile(outsideFile, "utf8"), "untouched")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("applicant runner rejects a symlink visual directory", async () => {
  const repoRoot = await createEvidenceRepo()
  const outsideDirectory = path.join(repoRoot, "outside-visuals")
  const visualQaDir = path.join(repoRoot, ".omo/evidence/visuals")
  try {
    await mkdir(outsideDirectory)
    await symlink(outsideDirectory, visualQaDir)
    await assert.rejects(
      resolveCoachApplicantEvidencePaths({ visualQaDir, repoRoot }),
      /contains symlink|real directory/u,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("applicant runner rejects any symlink component", async () => {
  const repoRoot = await createEvidenceRepo()
  const outsideDirectory = path.join(repoRoot, "outside-component")
  const linkedComponent = path.join(repoRoot, ".omo/evidence/linked")
  try {
    await mkdir(outsideDirectory)
    await symlink(outsideDirectory, linkedComponent)
    await assert.rejects(
      resolveCoachApplicantEvidencePaths({
        outputPath: path.join(linkedComponent, "nested", "summary.json"),
        repoRoot,
      }),
      /contains symlink/u,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("applicant runner rejects visual traversal and a symlinked .omo ancestor", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-ancestor-"))
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-outside-"))
  await mkdir(path.join(outsideDirectory, "evidence"))
  await symlink(outsideDirectory, path.join(repoRoot, ".omo"))
  try {
    await assert.rejects(
      resolveCoachApplicantEvidencePaths({
        outputPath: ".omo/evidence/summary.json",
        repoRoot,
        visualQaDir: ".omo/evidence/../visuals",
      }),
      /must not escape|\.omo must be a real directory|canonical repository/u,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
    await rm(outsideDirectory, { force: true, recursive: true })
  }
})

async function createEvidenceRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-paths-"))
  await mkdir(path.join(repoRoot, ".omo/evidence"), { mode: 0o700, recursive: true })
  return repoRoot
}
