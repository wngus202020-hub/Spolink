import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  assertMode700,
  assertVisualOwnershipReject,
  createProfileRunnerFixture,
  createRunRoot,
  removeTempDir,
  runFakeProfileRunner,
  runFixtureDefaultProfileRunner,
  runFixtureProfileRunner,
} from "./mypage-profile-edit-runner-fixture.mjs"
import {
  ProfileEditPublicationError,
  prepareProfileEditVisualWorkspace,
  writeProfileEditPublicationManifest,
} from "./mypage-profile-edit-runner-visual-publication.mjs"

const defaultVisualDir = ".omo/evidence/mypage-profile-edit/task-7-visual"
const pngs = [
  "profile-edit-legacy-desktop-chromium.png",
  "profile-edit-legacy-mobile-chromium.png",
  "profile-edit-legacy-tablet-chromium.png",
  "profile-edit-success-desktop-chromium.png",
  "profile-edit-success-mobile-chromium.png",
  "profile-edit-success-tablet-chromium.png",
  "profile-edit-validation-mobile-chromium.png",
]

test("ordinary success reruns and forced failures never mutate canonical evidence", async () => {
  const fixture = await createProfileRunnerFixture("success")
  const canonicalRoot = path.join(fixture.repoRoot, ".omo/evidence/mypage-profile-edit")
  const canonicalVisualDir = path.join(canonicalRoot, "task-7-visual")
  const canonicalSummaryPath = path.join(canonicalRoot, "task-7-mypage-profile-edit.json")
  const canonicalReceiptPath = path.join(
    canonicalRoot,
    "support/task-7-evidence-closure-receipt.json",
  )
  const canonicalFiles = [canonicalSummaryPath, canonicalReceiptPath]
  try {
    await mkdir(path.dirname(canonicalReceiptPath), { mode: 0o700, recursive: true })
    await mkdir(canonicalVisualDir, { mode: 0o700, recursive: true })
    for (const [index, name] of pngs.entries()) {
      const filePath = path.join(canonicalVisualDir, name)
      await writeFile(filePath, `canonical-png-${index}\n`, { mode: 0o600 })
      canonicalFiles.push(filePath)
    }
    await writeFile(canonicalSummaryPath, "canonical-summary\n", { mode: 0o600 })
    await writeFile(canonicalReceiptPath, "canonical-receipt\n", { mode: 0o600 })
    const before = await readFiles(canonicalFiles)

    const first = await runFixtureDefaultProfileRunner(fixture)
    assert.equal(first.exitCode, 0, first.stderr)
    const second = await runFixtureDefaultProfileRunner(fixture)
    assert.equal(second.exitCode, 0, second.stderr)
    await writeFile(path.join(fixture.repoRoot, "fake-playwright-mode"), "signal\n", {
      mode: 0o600,
    })
    const failed = await runFixtureDefaultProfileRunner(fixture)
    assert.equal(failed.exitCode, 1, failed.stderr)

    assert.deepEqual(await readFiles(canonicalFiles), before)
    const runDirectories = await readdir(path.join(canonicalRoot, "runs"))
    assert.equal(runDirectories.length, 3)
    assert.equal(new Set(runDirectories).size, 3)
    for (const runDirectory of runDirectories) {
      const runRoot = path.join(canonicalRoot, "runs", runDirectory)
      await assertMode700(runRoot)
      assert.equal((await stat(path.join(runRoot, "summary.json"))).mode & 0o777, 0o600)
    }
  } finally {
    await fixture.cleanup()
  }
})

test("custom visual dir rejects an existing external sentinel directory without deletion", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-edit-outside-"))
  const visualDir = path.join(outside, "visual")
  const sentinelPath = path.join(visualDir, "sentinel.txt")
  const sentinel = Buffer.from("external sentinel must survive\n")
  await mkdir(visualDir, { mode: 0o700 })
  await writeFile(sentinelPath, sentinel, { mode: 0o600 })
  const result = await runFakeProfileRunner("success", {
    extraEnv: { SPOLINK_VISUAL_QA_DIR: visualDir },
  })
  try {
    await assertVisualOwnershipReject(result)
    assert.deepEqual(await readFile(sentinelPath), sentinel)
  } finally {
    await result.cleanup()
    await removeTempDir(outside)
  }
})

test("custom visual dir rejects parent escapes and symlinks while preserving sentinels", async () => {
  const fixture = await createProfileRunnerFixture("success")
  const { outputPath, runRoot } = await createRunRoot(fixture)
  const escapeDir = path.join(fixture.repoRoot, ".omo/evidence/escaped-profile-edit-visual")
  const linkedTarget = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-edit-linked-"))
  const escapeSentinel = Buffer.from("escaped sentinel must survive\n")
  const linkedSentinel = Buffer.from("symlink target sentinel must survive\n")
  await mkdir(escapeDir, { mode: 0o700 })
  await writeFile(path.join(escapeDir, "sentinel.txt"), escapeSentinel, { mode: 0o600 })
  await writeFile(path.join(linkedTarget, "sentinel.txt"), linkedSentinel, { mode: 0o600 })
  const linkPath = path.join(runRoot, "visual-link")
  await symlink(linkedTarget, linkPath)
  try {
    const escaped = await runFixtureProfileRunner(fixture, outputPath, {
      SPOLINK_VISUAL_QA_DIR: path.join(runRoot, "..", path.basename(escapeDir)),
    })
    await assertVisualOwnershipReject({ ...escaped, outputPath })
    const linked = await runFixtureProfileRunner(fixture, outputPath, {
      SPOLINK_VISUAL_QA_DIR: linkPath,
    })
    await assertVisualOwnershipReject({ ...linked, outputPath })
    assert.deepEqual(await readFile(path.join(escapeDir, "sentinel.txt")), escapeSentinel)
    assert.deepEqual(await readFile(path.join(linkedTarget, "sentinel.txt")), linkedSentinel)
    assert.equal((await lstat(linkPath)).isSymbolicLink(), true)
  } finally {
    await fixture.cleanup()
    await removeTempDir(linkedTarget)
  }
})

test("custom visual dir accepts only a fresh direct child of the output parent", async () => {
  const fixture = await createProfileRunnerFixture("success")
  const { outputPath, runRoot } = await createRunRoot(fixture)
  const visualDir = path.join(runRoot, "visual")
  try {
    const parentResult = await runFixtureProfileRunner(fixture, outputPath, {
      SPOLINK_VISUAL_QA_DIR: runRoot,
    })
    await assertVisualOwnershipReject({ ...parentResult, outputPath })
    const childResult = await runFixtureProfileRunner(fixture, outputPath, {
      SPOLINK_VISUAL_QA_DIR: visualDir,
    })
    assert.equal(childResult.exitCode, 0, childResult.stderr)
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).verdict, "APPROVE")
    await assertMode700(visualDir)
    assert.deepEqual(
      (await readdir(visualDir)).filter((entry) => entry.endsWith(".png")).sort(),
      pngs,
    )
  } finally {
    await fixture.cleanup()
  }
})

test("default visual publication replaces a real directory without live recursive deletion", async () => {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  const stalePath = path.join(finalDir, "stale-sentinel.txt")
  try {
    await mkdir(finalDir, { mode: 0o700, recursive: true })
    await writeFile(stalePath, "stale default visual output\n", { mode: 0o600 })
    const workspace = await prepareWorkspace(repoRoot)
    await writeValidGeneration(workspace, repoRoot)
    await workspace.publish()
    await access(path.join(finalDir, pngs[0]))
    await assert.rejects(() => access(stalePath), /ENOENT/u)
    await assertMode700(finalDir)
  } finally {
    await removeTempDir(repoRoot)
  }
})

test("default publication rejects a partial weak-mode generation before canonical mutation", async () => {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  const canonicalPath = path.join(finalDir, "canonical.txt")
  try {
    await mkdir(finalDir, { mode: 0o700, recursive: true })
    await writeFile(canonicalPath, "canonical-before\n", { mode: 0o600 })
    const workspace = await prepareWorkspace(repoRoot)
    await writeFile(path.join(workspace.captureDir, "partial-tampered.png"), "not a png\n", {
      mode: 0o644,
    })

    await assert.rejects(
      () => workspace.publish(),
      (error) =>
        error instanceof ProfileEditPublicationError &&
        error.code === "GENERATION_FILE_SET_INVALID",
    )
    assert.equal(await readFile(canonicalPath, "utf8"), "canonical-before\n")
    await assert.rejects(() => access(workspace.captureDir), /ENOENT/u)
  } finally {
    await removeTempDir(repoRoot)
  }
})

test("default publication rejects every incomplete, stale, unsafe, or unbound generation", async (t) => {
  const cases = [
    [
      "missing canonical filename",
      async ({ workspace }) => {
        await rm(path.join(workspace.captureDir, pngs[0]))
      },
      "GENERATION_FILE_SET_INVALID",
    ],
    [
      "extra filename",
      async ({ workspace }) => {
        await writeFile(path.join(workspace.captureDir, "extra.png"), validPng, { mode: 0o600 })
      },
      "GENERATION_FILE_SET_INVALID",
    ],
    [
      "logical duplicate filename",
      async ({ workspace }) => {
        await mutateManifest(workspace.captureDir, (manifest) => {
          manifest.pngs[1] = { ...manifest.pngs[0] }
        })
      },
      "GENERATION_PNG_SET_INVALID",
    ],
    [
      "non-PNG content",
      async ({ workspace }) => {
        await writeFile(path.join(workspace.captureDir, pngs[0]), "not a png\n")
      },
      "GENERATION_PNG_INVALID",
    ],
    [
      "weak file mode",
      async ({ workspace }) => {
        await chmod(path.join(workspace.captureDir, pngs[0]), 0o644)
      },
      "GENERATION_FILE_UNSAFE",
    ],
    [
      "weak source directory mode",
      async ({ workspace }) => {
        await chmod(workspace.captureDir, 0o755)
      },
      "GENERATION_DIRECTORY_UNSAFE",
    ],
    [
      "stale expected PNG hash",
      async ({ workspace }) => {
        await mutateManifest(workspace.captureDir, (manifest) => {
          manifest.pngs[0].sha256 = "0".repeat(64)
        })
      },
      "GENERATION_PNG_STALE",
    ],
    [
      "missing success observable",
      async ({ repoRoot, workspace }) => {
        await mutateObservations(workspace.captureDir, (observation) => {
          if (observation.receipt?.name === "profile-edit-success-desktop-chromium.png") {
            delete observation.receipt.successConfirmation
          }
        })
        await writeProfileEditPublicationManifest({
          repoRoot,
          sourcePaths: ["publication-source.txt"],
          stagingDir: workspace.captureDir,
        })
      },
      "GENERATION_SUCCESS_OBSERVABLE_MISSING",
    ],
    [
      "BROWSER-03 missing region validation receipt",
      async ({ repoRoot, workspace }) => {
        await mutateObservations(workspace.captureDir, (observation) => {
          if (observation.receipt?.name === "profile-edit-validation-mobile-chromium.png") {
            delete observation.receipt.validationFeedback
          }
        })
        await writeProfileEditPublicationManifest({
          repoRoot,
          sourcePaths: ["publication-source.txt"],
          stagingDir: workspace.captureDir,
        })
      },
      "GENERATION_REGION_VALIDATION_OBSERVABLE_MISSING",
    ],
    [
      "BROWSER-03 rejects another field validation receipt",
      async ({ repoRoot, workspace }) => {
        await mutateObservations(workspace.captureDir, (observation) => {
          if (observation.receipt?.name === "profile-edit-validation-mobile-chromium.png") {
            observation.receipt.validationFeedback.field = "displayName"
          }
        })
        await writeProfileEditPublicationManifest({
          repoRoot,
          sourcePaths: ["publication-source.txt"],
          stagingDir: workspace.captureDir,
        })
      },
      "GENERATION_REGION_VALIDATION_OBSERVABLE_MISSING",
    ],
    [
      "unsafe sensitive observation metadata",
      async ({ repoRoot, workspace }) => {
        await mutateObservations(workspace.captureDir, (observation) => {
          if (observation.type === "screenshot") observation.unsafeMetadata = "user@example.com"
        })
        await writeProfileEditPublicationManifest({
          repoRoot,
          sourcePaths: ["publication-source.txt"],
          stagingDir: workspace.captureDir,
        })
      },
      "GENERATION_MANIFEST_INVALID",
    ],
    [
      "unsafe PNG text metadata",
      async ({ repoRoot, workspace }) => {
        await writeFile(path.join(workspace.captureDir, pngs[0]), pngWithSensitiveMetadata(), {
          mode: 0o600,
        })
        await writeProfileEditPublicationManifest({
          repoRoot,
          sourcePaths: ["publication-source.txt"],
          stagingDir: workspace.captureDir,
        })
      },
      "GENERATION_MANIFEST_INVALID",
    ],
    [
      "unsafe publication source metadata",
      async ({ repoRoot, workspace }) => {
        const sourcePath = "user@example.com"
        const bytes = Buffer.from("sensitive source metadata\n")
        await writeFile(path.join(repoRoot, sourcePath), bytes, { mode: 0o600 })
        await mutateManifest(workspace.captureDir, (manifest) => {
          const hash = sha256(bytes)
          manifest.sourceBinding = {
            aggregateSha256: sha256(`${hash}  ${sourcePath}\n`),
            files: [{ path: sourcePath, sha256: hash }],
          }
        })
      },
      "GENERATION_REDACTION_INVALID",
    ],
    [
      "stale source binding",
      async ({ repoRoot }) => {
        await writeFile(path.join(repoRoot, "publication-source.txt"), "changed source\n")
      },
      "GENERATION_SOURCE_STALE",
    ],
    [
      "tampered redaction receipt",
      async ({ workspace }) => {
        await mutateManifest(workspace.captureDir, (manifest) => {
          manifest.redaction.observationsSha256 = "0".repeat(64)
        })
      },
      "GENERATION_REDACTION_INVALID",
    ],
    [
      "stale generation metadata",
      async ({ workspace }) => {
        await mutateManifest(workspace.captureDir, (manifest) => {
          manifest.generatedAt = "2020-01-01T00:00:00.000Z"
        })
      },
      "GENERATION_METADATA_STALE",
    ],
  ]

  for (const [name, mutate, expectedCode] of cases) {
    await t.test(name, async () => {
      await assertGenerationRejected(mutate, expectedCode)
    })
  }
})

test("failure after validation but before the atomic switch preserves canonical evidence", async () => {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  const canonicalPath = path.join(finalDir, "canonical.txt")
  let validationReached = false
  try {
    await mkdir(finalDir, { mode: 0o700, recursive: true })
    await writeFile(canonicalPath, "canonical-before\n", { mode: 0o600 })
    const workspace = await prepareWorkspace(repoRoot, {
      afterGenerationValidation: async () => {
        validationReached = true
        throw new Error("forced after-validation failure")
      },
    })
    await writeValidGeneration(workspace, repoRoot)

    await assert.rejects(() => workspace.publish(), /forced after-validation failure/u)
    assert.equal(validationReached, true)
    assert.equal(await readFile(canonicalPath, "utf8"), "canonical-before\n")
    await assert.rejects(() => access(workspace.captureDir), /ENOENT/u)
  } finally {
    await removeTempDir(repoRoot)
  }
})

test("default visual publication unlinks quarantined symlinks and preserves targets", async () => {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-edit-target-"))
  const sentinel = Buffer.from("target sentinel must survive\n")
  try {
    await mkdir(path.dirname(finalDir), { mode: 0o700, recursive: true })
    await writeFile(path.join(targetDir, "sentinel.txt"), sentinel, { mode: 0o600 })
    await symlink(targetDir, finalDir)
    const workspace = await prepareWorkspace(repoRoot)
    await writeValidGeneration(workspace, repoRoot)
    await workspace.publish()
    assert.equal((await stat(finalDir)).isDirectory(), true)
    assert.deepEqual(await readFile(path.join(targetDir, "sentinel.txt")), sentinel)
  } finally {
    await removeTempDir(repoRoot)
    await removeTempDir(targetDir)
  }
})

test("default visual pre-rename hook handles symlink and directory swaps deterministically", async () => {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-edit-hook-target-"))
  const preservedOld = path.join(path.dirname(finalDir), "old-preserved")
  const swappedDir = path.join(path.dirname(finalDir), "swapped-dir")
  const sentinel = Buffer.from("hook target sentinel must survive\n")
  try {
    await mkdir(finalDir, { mode: 0o700, recursive: true })
    await mkdir(swappedDir, { mode: 0o700 })
    await writeFile(path.join(finalDir, "old.txt"), "old\n", { mode: 0o600 })
    await writeFile(path.join(swappedDir, "swap.txt"), "swap\n", { mode: 0o600 })
    await writeFile(path.join(targetDir, "sentinel.txt"), sentinel, { mode: 0o600 })
    const symlinkWorkspace = await prepareWorkspace(repoRoot, {
      beforeDefaultReplace: async () => {
        await rename(finalDir, preservedOld)
        await symlink(targetDir, finalDir)
      },
    })
    await writeValidGeneration(symlinkWorkspace, repoRoot)
    await symlinkWorkspace.publish()
    assert.deepEqual(await readFile(path.join(targetDir, "sentinel.txt")), sentinel)
    assert.equal(await readFile(path.join(preservedOld, "old.txt"), "utf8"), "old\n")

    const directoryWorkspace = await prepareWorkspace(repoRoot, {
      beforeDefaultReplace: async () => {
        await rm(finalDir, { recursive: true })
        await rename(swappedDir, finalDir)
      },
    })
    await writeValidGeneration(directoryWorkspace, repoRoot)
    await directoryWorkspace.publish()
    await access(path.join(finalDir, pngs[0]))
    await assert.rejects(() => access(path.join(finalDir, "swap.txt")), /ENOENT/u)
  } finally {
    await removeTempDir(repoRoot)
    await removeTempDir(targetDir)
  }
})

test("default visual publication failure restores the previous real directory", async () => {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  let quarantineDir = null
  try {
    await mkdir(finalDir, { mode: 0o700, recursive: true })
    await writeFile(path.join(finalDir, "old.txt"), "old\n", { mode: 0o600 })
    const workspace = await prepareWorkspace(repoRoot, {
      afterExistingQuarantine: async ({ quarantineDir: candidate }) => {
        quarantineDir = candidate
        throw new Error("forced publication failure")
      },
    })
    await writeValidGeneration(workspace, repoRoot)
    await assert.rejects(() => workspace.publish(), /forced publication failure/u)
    assert.equal(await readFile(path.join(finalDir, "old.txt"), "utf8"), "old\n")
    if (quarantineDir) await assert.rejects(() => access(quarantineDir), /ENOENT/u)
    await assert.rejects(() => access(workspace.captureDir), /ENOENT/u)
  } finally {
    await removeTempDir(repoRoot)
  }
})

async function makeRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-edit-repo-"))
  await mkdir(path.join(repoRoot, ".omo/evidence/mypage-profile-edit"), {
    mode: 0o700,
    recursive: true,
  })
  await writeFile(path.join(repoRoot, "publication-source.txt"), "current source\n", {
    mode: 0o600,
  })
  return repoRoot
}

async function prepareWorkspace(repoRoot, hooks = {}) {
  return prepareProfileEditVisualWorkspace({
    defaultVisualDir,
    hooks,
    outputPath: path.join(repoRoot, ".omo/evidence/mypage-profile-edit/summary.json"),
    requestedDir: null,
    repoRoot,
  })
}

async function readFiles(filePaths) {
  return Promise.all(filePaths.map((filePath) => readFile(filePath)))
}

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

async function writeValidGeneration(workspace, repoRoot) {
  const hash = sha256(validPng)
  for (const name of pngs) {
    await writeFile(path.join(workspace.captureDir, name), validPng, { mode: 0o600 })
  }
  const observations = pngs.map((name) => {
    const state = name.includes("-legacy-")
      ? "legacy"
      : name.includes("-validation-")
        ? "validation"
        : "success"
    const project = name.includes("desktop")
      ? "desktop-chromium"
      : name.includes("tablet")
        ? "tablet-chromium"
        : "mobile-chromium"
    return {
      project,
      receipt: {
        name,
        sha256: hash,
        state,
        ...(state === "validation"
          ? {
              validationFeedback: {
                ariaDescribedBy: true,
                ariaInvalid: true,
                errorId: "profile-edit-region-error",
                field: "defaultRegion",
                focusedSearchControl: true,
                onlyFieldError: true,
                text: "목록에서 기본 활동 지역을 선택해요.",
                visible: true,
              },
            }
          : {}),
        ...(state === "success"
          ? {
              successConfirmation: {
                inViewport: true,
                role: "status",
                state: "rendered",
                text: "프로필 정보를 저장했어요.",
                visible: true,
              },
            }
          : {}),
      },
      type: "screenshot",
    }
  })
  await writeFile(
    path.join(workspace.captureDir, "observations.jsonl"),
    `${observations.map((item) => JSON.stringify(item)).join("\n")}\n`,
    { mode: 0o600 },
  )
  await writeProfileEditPublicationManifest({
    repoRoot,
    sourcePaths: ["publication-source.txt"],
    stagingDir: workspace.captureDir,
  })
}

async function assertGenerationRejected(mutate, expectedCode) {
  const repoRoot = await makeRepo()
  const finalDir = path.join(repoRoot, defaultVisualDir)
  const canonicalPath = path.join(finalDir, "canonical.txt")
  try {
    await mkdir(finalDir, { mode: 0o700, recursive: true })
    await writeFile(canonicalPath, "canonical-before\n", { mode: 0o600 })
    const workspace = await prepareWorkspace(repoRoot)
    await writeValidGeneration(workspace, repoRoot)
    await mutate({ repoRoot, workspace })
    await assert.rejects(
      () => workspace.publish(),
      (error) => error instanceof ProfileEditPublicationError && error.code === expectedCode,
    )
    assert.equal(await readFile(canonicalPath, "utf8"), "canonical-before\n")
    await assert.rejects(() => access(workspace.captureDir), /ENOENT/u)
  } finally {
    await removeTempDir(repoRoot)
  }
}

async function mutateManifest(stagingDir, mutate) {
  const manifestPath = path.join(stagingDir, ".publication.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  mutate(manifest)
  const { selfHash: _selfHash, ...payload } = manifest
  manifest.selfHash = { algorithm: "sha256", value: sha256(JSON.stringify(payload)) }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
}

async function mutateObservations(stagingDir, mutate) {
  const observationsPath = path.join(stagingDir, "observations.jsonl")
  const observations = (await readFile(observationsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  for (const observation of observations) mutate(observation)
  await writeFile(
    observationsPath,
    `${observations.map((item) => JSON.stringify(item)).join("\n")}\n`,
    { mode: 0o600 },
  )
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function pngWithSensitiveMetadata() {
  const data = Buffer.from("email\0user@example.com")
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write("tEXt", 4, 4, "ascii")
  data.copy(chunk, 8)
  return Buffer.concat([validPng.subarray(0, -12), chunk, validPng.subarray(-12)])
}
