import assert from "node:assert/strict"
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createFakeLifecycleRepo, requiredEnv } from "./fake-lifecycle-harness.mjs"
import { writeProfileEditCorepack } from "./mypage-profile-edit-runner-corepack-fixture.mjs"
import { runBuffered, sha256 } from "./process.mjs"

export const repoRoot = process.cwd()
export const runnerPath = path.join(repoRoot, "tests/auth-ui-e2e/run-mypage-profile-edit.mjs")
export const packagePath = path.join(repoRoot, "package.json")
export const profileSpec = "tests/auth-ui-e2e/mypage-profile-edit.spec.ts"
export const projects = ["desktop-chromium", "tablet-chromium", "mobile-chromium"]

export async function runFakeProfileRunner(
  mode,
  { createSupabaseTemp = false, extraEnv = {}, preexistingSupabaseTemp = false } = {},
) {
  const fixture = await createProfileRunnerFixture(mode, {
    createSupabaseTemp,
    preexistingSupabaseTemp,
  })
  const runRoot = await mkdtemp(path.join(fixture.repoRoot, ".omo/evidence/profile-edit-run-"))
  const outputPath = path.join(runRoot, "profile-edit-summary.json")
  let result
  try {
    result = await runFixtureProfileRunner(fixture, outputPath, extraEnv)
  } catch (error) {
    await fixture.cleanup()
    throw error
  }
  return {
    ...result,
    cleanup: fixture.cleanup,
    logPath: fixture.logPath,
    outputPath,
    rawMarkerPath: path.join(fixture.repoRoot, "raw-output-dir.json"),
    repoRoot: fixture.repoRoot,
  }
}

export async function createProfileRunnerFixture(
  mode,
  { createSupabaseTemp = false, preexistingSupabaseTemp = false } = {},
) {
  const fixture = await createFakeLifecycleRepo("spolink-profile-edit-runner-")
  fixture.tmpDir = path.join(fixture.repoRoot, "tmp")
  await mkdir(fixture.tmpDir, { mode: 0o700 })
  if (preexistingSupabaseTemp) {
    await mkdir(path.join(fixture.repoRoot, "supabase/.temp"), { mode: 0o700, recursive: true })
    await writeFile(path.join(fixture.repoRoot, "supabase/.temp/cli-latest"), "preexisting\n", {
      mode: 0o600,
    })
  }
  const modePath = path.join(fixture.repoRoot, "fake-playwright-mode")
  await writeFile(modePath, `${mode}\n`, { mode: 0o600 })
  await writeProfileEditCorepack(path.join(fixture.binDir, "corepack"), {
    createSupabaseTemp,
    logPath: fixture.logPath,
    modePath,
    rawMarkerPath: path.join(fixture.repoRoot, "raw-output-dir.json"),
    repoRoot: fixture.repoRoot,
  })
  return fixture
}

export async function runFixtureProfileRunner(fixture, outputPath, extraEnv = {}) {
  return runBuffered(process.execPath, [runnerPath, outputPath], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      TMPDIR: fixture.tmpDir,
      ...extraEnv,
    },
    timeoutMs: 30_000,
  })
}

export async function runFixtureDefaultProfileRunner(fixture, extraEnv = {}) {
  return runBuffered(process.execPath, [runnerPath], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
      TMPDIR: fixture.tmpDir,
      ...extraEnv,
    },
    timeoutMs: 30_000,
  })
}

export async function readPlaywrightInvocation(logPath) {
  const log = await readFile(logPath, "utf8")
  const line = log.split(/\r?\n/u).find((entry) => entry.startsWith("playwright-args-json="))
  assert.ok(line, `missing fake playwright invocation\n${log}`)
  const args = JSON.parse(line.slice("playwright-args-json=".length))
  return {
    projects: args.filter((arg) => arg.startsWith("--project=")).map((arg) => arg.slice(10)),
    spec: args.find((arg) => arg.endsWith(".spec.ts")),
    workers: args.at(args.indexOf("--workers") + 1),
  }
}

export async function accessRawOutputDir(rawMarkerPath) {
  await access(await readPlaywrightOutputDir(rawMarkerPath))
}

export function assertNoSensitiveMaterial(value) {
  assert.doesNotMatch(
    value,
    /kimjuhyeon|user@example\.com|postgres(?:ql)?:\/\/|sb_secret_|sb_publishable_/iu,
  )
  assert.doesNotMatch(value, /fixture|identity|cookie|token|authorization|password/iu)
}

export async function assertVisualOwnershipReject(result) {
  assert.equal(result.exitCode, 1, result.stderr)
  const summaryText = await readFile(result.outputPath, "utf8")
  const summary = JSON.parse(summaryText)
  assert.equal(summary.verdict, "REJECT")
  assert.equal(summary.exitCode, null)
  assert.equal(summary.visual.verdict, "REJECT")
  assert.match(summary.visual.errorHash, /^[a-f0-9]{64}$/u)
  assertNoSensitiveMaterial(summaryText)
  assert.doesNotMatch(summaryText, /spolink-profile-edit-|\/tmp|\/var\/folders|sentinel/iu)
}

export async function createRunRoot(fixture) {
  const runRoot = await mkdtemp(path.join(fixture.repoRoot, ".omo/evidence/profile-edit-run-"))
  return {
    outputPath: path.join(runRoot, "profile-edit-summary.json"),
    runRoot,
  }
}

export function childTestEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST")),
  )
}

export async function createMode700TempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  await chmod(dir, 0o700)
  return dir
}

export async function removeTempDir(dir) {
  await rm(dir, { force: true, recursive: true })
}

export async function assertMode700(directory) {
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
}

async function readPlaywrightOutputDir(rawMarkerPath) {
  const marker = JSON.parse(await readFile(rawMarkerPath, "utf8"))
  return marker.dir
}

export { sha256 }
