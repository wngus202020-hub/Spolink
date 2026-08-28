import { createHash, randomBytes } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

const defaultRunsDir = ".omo/evidence/mypage-profile-edit/runs"
const publicationManifestName = ".publication.json"
const observationsName = "observations.jsonl"
const expectedPngNames = [
  "profile-edit-legacy-desktop-chromium.png",
  "profile-edit-legacy-mobile-chromium.png",
  "profile-edit-legacy-tablet-chromium.png",
  "profile-edit-success-desktop-chromium.png",
  "profile-edit-success-mobile-chromium.png",
  "profile-edit-success-tablet-chromium.png",
  "profile-edit-validation-mobile-chromium.png",
]
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const fileBindingSchema = z.object({ name: z.string().min(1), sha256: sha256Schema }).strict()
const sourceBindingSchema = z
  .object({
    aggregateSha256: sha256Schema,
    files: z.array(z.object({ path: z.string().min(1), sha256: sha256Schema }).strict()).min(1),
  })
  .strict()
const publicationManifestSchema = z
  .object({
    generatedAt: z.string().datetime(),
    generationId: z.string().regex(/^[a-f0-9]{32}$/u),
    observations: fileBindingSchema,
    pngs: z.array(fileBindingSchema).length(expectedPngNames.length),
    redaction: z
      .object({
        observationsSha256: sha256Schema,
        pngAggregateSha256: sha256Schema,
        scannedPngCount: z.literal(expectedPngNames.length),
        sensitiveHits: z.literal(0),
        verdict: z.literal("APPROVE"),
      })
      .strict(),
    schemaVersion: z.literal(1),
    selfHash: z.object({ algorithm: z.literal("sha256"), value: sha256Schema }).strict(),
    sourceBinding: sourceBindingSchema,
    type: z.literal("profile-edit-visual-publication-generation"),
  })
  .strict()
const successConfirmationSchema = z
  .object({
    inViewport: z.literal(true),
    role: z.literal("status"),
    state: z.literal("rendered"),
    text: z.literal("프로필 정보를 저장했어요."),
    visible: z.literal(true),
  })
  .strict()
const regionValidationFeedbackSchema = z
  .object({
    ariaDescribedBy: z.literal(true),
    ariaInvalid: z.literal(true),
    errorId: z.literal("profile-edit-region-error"),
    field: z.literal("defaultRegion"),
    focusedSearchControl: z.literal(true),
    onlyFieldError: z.literal(true),
    text: z.literal("목록에서 기본 활동 지역을 선택해요."),
    visible: z.literal(true),
  })
  .strict()
const screenshotObservationSchema = z
  .object({
    project: z.enum(["desktop-chromium", "mobile-chromium", "tablet-chromium"]),
    receipt: z
      .object({
        name: z.string().min(1),
        sha256: sha256Schema,
        state: z.enum(["legacy", "success", "validation"]),
        successConfirmation: successConfirmationSchema.optional(),
        validationFeedback: z.unknown().optional(),
      })
      .passthrough(),
    type: z.literal("screenshot"),
  })
  .passthrough()
const sensitivePatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /01[016789][ -]?[0-9]{3,4}[ -]?[0-9]{4}/u,
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  /Bearer\s|authorization|access_token|refresh_token|password|sb_secret_/iu,
]

export class ProfileEditPublicationError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.name = "ProfileEditPublicationError"
  }
}

export async function writeProfileEditPublicationManifest({
  repoRoot = process.cwd(),
  sourcePaths,
  stagingDir,
}) {
  const pngs = await Promise.all(
    expectedPngNames.map(async (name) => ({
      name,
      sha256: sha256(await readFile(path.join(stagingDir, name))),
    })),
  )
  const observationsBytes = await readFile(path.join(stagingDir, observationsName))
  const sourceBinding = await readCurrentSourceBinding(repoRoot, sourcePaths)
  const sensitiveHits =
    (await countSensitiveGenerationMaterial(stagingDir, observationsBytes)) +
    countSensitiveText(JSON.stringify(sourceBinding))
  const payload = {
    generatedAt: new Date().toISOString(),
    generationId: randomBytes(16).toString("hex"),
    observations: { name: observationsName, sha256: sha256(observationsBytes) },
    pngs,
    redaction: {
      observationsSha256: sha256(observationsBytes),
      pngAggregateSha256: pngAggregateSha256(pngs),
      scannedPngCount: expectedPngNames.length,
      sensitiveHits,
      verdict: sensitiveHits === 0 ? "APPROVE" : "REJECT",
    },
    schemaVersion: 1,
    sourceBinding,
    type: "profile-edit-visual-publication-generation",
  }
  const manifestPath = path.join(stagingDir, publicationManifestName)
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...payload,
        selfHash: { algorithm: "sha256", value: sha256(JSON.stringify(payload)) },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
  await chmod(manifestPath, 0o600)
  return manifestPath
}

export async function createProfileEditRunTarget({
  repoRoot = process.cwd(),
  runsDir = defaultRunsDir,
} = {}) {
  const canonicalRepoRoot = await realpath(repoRoot)
  const resolvedRunsDir = path.resolve(canonicalRepoRoot, runsDir)
  const expectedRunsDir = path.join(canonicalRepoRoot, runsDir)
  if (resolvedRunsDir !== expectedRunsDir)
    throw new Error("Profile edit runs must resolve under repo")
  await assertNoSymlinkAncestors(canonicalRepoRoot, path.dirname(resolvedRunsDir))
  await mkdir(resolvedRunsDir, { mode: 0o700, recursive: true })
  await assertNoSymlinkAncestors(canonicalRepoRoot, resolvedRunsDir)
  await assertOwnedDirectory(resolvedRunsDir, "Profile edit runs directory")
  const runRoot = await mkdtemp(path.join(resolvedRunsDir, "run-"))
  await chmod(runRoot, 0o700)
  await assertOwnedDirectory(runRoot, "Profile edit run directory")
  return {
    outputPath: path.join(runRoot, "summary.json"),
    visualDir: path.join(runRoot, "visual"),
  }
}

export async function prepareProfileEditVisualWorkspace({
  defaultVisualDir,
  hooks = {},
  outputPath,
  requestedDir,
  repoRoot = process.cwd(),
}) {
  if (requestedDir === null || path.resolve(requestedDir) === path.resolve(defaultVisualDir)) {
    return prepareDefaultVisualWorkspace({ defaultVisualDir, hooks, repoRoot })
  }
  return prepareCustomVisualWorkspace({ outputPath, requestedDir })
}

async function prepareDefaultVisualWorkspace({ defaultVisualDir, hooks, repoRoot }) {
  const canonicalRepoRoot = await realpath(repoRoot)
  const finalDir = path.resolve(canonicalRepoRoot, defaultVisualDir)
  const expected = path.join(canonicalRepoRoot, defaultVisualDir)
  if (finalDir !== expected) throw new Error("Default visual directory must resolve under repo")
  const parent = path.dirname(finalDir)
  await assertNoSymlinkAncestors(canonicalRepoRoot, parent)
  await mkdir(parent, { mode: 0o700, recursive: true })
  await assertNoSymlinkAncestors(canonicalRepoRoot, parent)
  const stagingDir = await mkdtemp(path.join(parent, ".task-7-visual-staging-"))
  await chmod(stagingDir, 0o700)
  await assertOwnedDirectory(stagingDir, "Default visual staging directory")

  let published = false
  return {
    captureDir: stagingDir,
    finalDir,
    mode: "default",
    async cleanup() {
      if (published) return { mode: "default", verdict: "APPROVE" }
      await removeByLstat(stagingDir)
      return { mode: "default", verdict: "APPROVE" }
    },
    async publish() {
      await publishDefaultVisualDirectory({
        finalDir,
        hooks,
        repoRoot: canonicalRepoRoot,
        stagingDir,
      })
      published = true
      return { mode: "default", verdict: "APPROVE" }
    },
  }
}

async function prepareCustomVisualWorkspace({ outputPath, requestedDir }) {
  if (requestedDir.includes("\0")) throw new Error("Custom visual directory is invalid")
  const outputParent = path.dirname(path.resolve(outputPath))
  await assertOwnedDirectory(outputParent, "Output manifest parent")
  const resolved = path.resolve(requestedDir)
  if (resolved === outputParent) {
    throw new Error("Custom visual directory must not be the output parent")
  }
  if (path.dirname(resolved) !== outputParent) {
    throw new Error("Custom visual directory must be a fresh direct child of the output parent")
  }
  await assertNoSymlinkAncestors(outputParent, path.dirname(resolved))
  if (await maybeLstat(resolved)) {
    throw new Error("Custom visual directory must not already exist")
  }
  await mkdir(resolved, { mode: 0o700 })
  await chmod(resolved, 0o700)
  await assertOwnedDirectory(resolved, "Custom visual directory")
  return {
    captureDir: resolved,
    finalDir: resolved,
    mode: "custom",
    async cleanup() {
      return { mode: "custom", verdict: "APPROVE" }
    },
    async publish() {
      return { mode: "custom", verdict: "APPROVE" }
    },
  }
}

async function publishDefaultVisualDirectory({ finalDir, hooks, repoRoot, stagingDir }) {
  const quarantineDir = path.join(
    path.dirname(finalDir),
    `.task-7-visual-quarantine-${randomBytes(16).toString("hex")}`,
  )
  let quarantined = false
  try {
    const manifest = await validatePublicationGenerationSafely({ repoRoot, stagingDir })
    await hooks.afterGenerationValidation?.({ finalDir, quarantineDir, stagingDir })
    await validatePublicationGenerationSafely({ manifest, repoRoot, stagingDir })
    await hooks.beforeDefaultReplace?.({ finalDir, quarantineDir, stagingDir })
    await validatePublicationGenerationSafely({ manifest, repoRoot, stagingDir })
    await unlink(path.join(stagingDir, publicationManifestName))
    await validatePublicationFilesSafely({ manifest, repoRoot, stagingDir })
    if (await maybeLstat(finalDir)) {
      await rename(finalDir, quarantineDir)
      quarantined = true
    }
    await hooks.afterExistingQuarantine?.({ finalDir, quarantineDir, stagingDir })
    await validatePublicationFilesSafely({ manifest, repoRoot, stagingDir })
    await rename(stagingDir, finalDir)
    await chmod(finalDir, 0o700)
    if (quarantined) await removeByLstat(quarantineDir)
  } catch (error) {
    await rollbackDefaultPublication({ finalDir, quarantineDir, quarantined, stagingDir })
    throw error
  }
}

async function validatePublicationGenerationSafely(input) {
  try {
    return await validatePublicationGeneration(input)
  } catch (error) {
    if (error instanceof ProfileEditPublicationError) throw error
    throw publicationError(
      "GENERATION_VALIDATION_FAILED",
      "Publication generation validation failed",
      error,
    )
  }
}

async function validatePublicationFilesSafely(input) {
  try {
    await validatePublicationFiles(input)
  } catch (error) {
    if (error instanceof ProfileEditPublicationError) throw error
    throw publicationError(
      "GENERATION_VALIDATION_FAILED",
      "Publication generation validation failed",
      error,
    )
  }
}

async function validatePublicationGeneration({ manifest: expectedManifest, repoRoot, stagingDir }) {
  await assertPublicationDirectory(stagingDir)
  const entries = (await readdir(stagingDir)).sort()
  const expectedEntries = [publicationManifestName, observationsName, ...expectedPngNames].sort()
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw publicationError(
      "GENERATION_FILE_SET_INVALID",
      "Publication generation file set is invalid",
    )
  }
  const manifestPath = path.join(stagingDir, publicationManifestName)
  await assertPublicationFile(manifestPath)
  const manifestText = await readFile(manifestPath, "utf8")
  let parsed
  try {
    parsed = publicationManifestSchema.parse(JSON.parse(manifestText))
  } catch (error) {
    throw publicationError(
      "GENERATION_MANIFEST_INVALID",
      "Publication generation manifest is invalid",
      error,
    )
  }
  const { selfHash, ...payload } = parsed
  if (sha256(JSON.stringify(payload)) !== selfHash.value) {
    throw publicationError(
      "GENERATION_MANIFEST_STALE",
      "Publication generation manifest hash is stale",
    )
  }
  if (expectedManifest && JSON.stringify(parsed) !== JSON.stringify(expectedManifest)) {
    throw publicationError("GENERATION_MANIFEST_CHANGED", "Publication generation manifest changed")
  }
  assertCurrentGenerationTimestamp(parsed.generatedAt)
  await validatePublicationFiles({ manifest: parsed, repoRoot, stagingDir })
  return parsed
}

async function validatePublicationFiles({ manifest, repoRoot, stagingDir }) {
  await assertPublicationDirectory(stagingDir)
  const entries = (await readdir(stagingDir)).sort()
  const expectedEntries = [observationsName, ...expectedPngNames].sort()
  const withManifest = [publicationManifestName, ...expectedEntries].sort()
  if (
    JSON.stringify(entries) !== JSON.stringify(expectedEntries) &&
    JSON.stringify(entries) !== JSON.stringify(withManifest)
  ) {
    throw publicationError(
      "GENERATION_FILE_SET_INVALID",
      "Publication generation file set is invalid",
    )
  }
  const manifestNames = manifest.pngs.map(({ name }) => name)
  if (
    new Set(manifestNames).size !== expectedPngNames.length ||
    JSON.stringify(manifestNames) !== JSON.stringify(expectedPngNames)
  ) {
    throw publicationError("GENERATION_PNG_SET_INVALID", "Publication PNG names are not exact")
  }
  const observationsPath = path.join(stagingDir, observationsName)
  await assertPublicationFile(observationsPath)
  const observationsBytes = await readFile(observationsPath)
  if (
    manifest.observations.name !== observationsName ||
    manifest.observations.sha256 !== sha256(observationsBytes)
  ) {
    throw publicationError("GENERATION_OBSERVATIONS_STALE", "Publication observations are stale")
  }
  const screenshots = parseScreenshotObservations(observationsBytes)
  for (const binding of manifest.pngs) {
    const filePath = path.join(stagingDir, binding.name)
    await assertPublicationFile(filePath)
    const bytes = await readFile(filePath)
    inspectPng(bytes)
    const actualHash = sha256(bytes)
    if (binding.sha256 !== actualHash) {
      throw publicationError(
        "GENERATION_PNG_STALE",
        `Publication PNG hash is stale: ${binding.name}`,
      )
    }
    if (screenshots.get(binding.name)?.sha256 !== actualHash) {
      throw publicationError(
        "GENERATION_RECEIPT_MISMATCH",
        `Publication screenshot receipt is stale: ${binding.name}`,
      )
    }
  }
  assertSuccessObservables(screenshots)
  assertRegionValidationObservable(screenshots)
  const sensitiveHits =
    (await countSensitiveGenerationMaterial(stagingDir, observationsBytes)) +
    countSensitiveText(JSON.stringify(manifest.sourceBinding))
  if (
    sensitiveHits !== 0 ||
    manifest.redaction.observationsSha256 !== sha256(observationsBytes) ||
    manifest.redaction.pngAggregateSha256 !== pngAggregateSha256(manifest.pngs)
  ) {
    throw publicationError(
      "GENERATION_REDACTION_INVALID",
      "Publication redaction receipt is invalid",
    )
  }
  await validateCurrentSourceBinding(repoRoot, manifest.sourceBinding)
}

function parseScreenshotObservations(bytes) {
  let observations
  try {
    observations = bytes
      .toString("utf8")
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((item) => item?.type === "screenshot")
      .map((item) => screenshotObservationSchema.parse(item))
  } catch (error) {
    throw publicationError(
      "GENERATION_OBSERVATIONS_INVALID",
      "Publication observations are invalid",
      error,
    )
  }
  const names = observations.map(({ receipt }) => receipt.name).sort()
  if (
    observations.length !== expectedPngNames.length ||
    new Set(names).size !== expectedPngNames.length ||
    JSON.stringify(names) !== JSON.stringify(expectedPngNames)
  ) {
    throw publicationError(
      "GENERATION_RECEIPT_SET_INVALID",
      "Publication screenshot receipts are not exact",
    )
  }
  for (const observation of observations) {
    const expectedProject = observation.receipt.name.includes("desktop")
      ? "desktop-chromium"
      : observation.receipt.name.includes("tablet")
        ? "tablet-chromium"
        : "mobile-chromium"
    const expectedState = observation.receipt.name.includes("-legacy-")
      ? "legacy"
      : observation.receipt.name.includes("-validation-")
        ? "validation"
        : "success"
    if (observation.project !== expectedProject || observation.receipt.state !== expectedState) {
      throw publicationError(
        "GENERATION_RECEIPT_STATE_INVALID",
        `Publication screenshot state is invalid: ${observation.receipt.name}`,
      )
    }
  }
  return new Map(observations.map(({ receipt }) => [receipt.name, receipt]))
}

function assertSuccessObservables(screenshots) {
  const successNames = expectedPngNames.filter((name) => name.includes("-success-"))
  for (const name of successNames) {
    const parsed = successConfirmationSchema.safeParse(screenshots.get(name)?.successConfirmation)
    if (!parsed.success) {
      throw publicationError(
        "GENERATION_SUCCESS_OBSERVABLE_MISSING",
        `Publication success observable is missing: ${name}`,
      )
    }
  }
}

function assertRegionValidationObservable(screenshots) {
  const name = "profile-edit-validation-mobile-chromium.png"
  const parsed = regionValidationFeedbackSchema.safeParse(screenshots.get(name)?.validationFeedback)
  if (!parsed.success) {
    throw publicationError(
      "GENERATION_REGION_VALIDATION_OBSERVABLE_MISSING",
      `Publication region validation observable is missing: ${name}`,
    )
  }
}

async function countSensitiveGenerationMaterial(stagingDir, observationsBytes) {
  let hits = countSensitiveText(observationsBytes.toString("utf8"))
  for (const name of expectedPngNames) {
    const bytes = await readFile(path.join(stagingDir, name))
    hits += inspectPng(bytes).sensitiveMetadataHits
  }
  return hits
}

function inspectPng(bytes) {
  if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw publicationError("GENERATION_PNG_INVALID", "Publication image is not a PNG")
  }
  let hasIdat = false
  let hasIend = false
  let offset = pngSignature.length
  let sensitiveMetadataHits = 0
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw publicationError("GENERATION_PNG_INVALID", "Publication PNG chunk is truncated")
    }
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    const nextOffset = dataStart + length + 4
    if (nextOffset > bytes.length) {
      throw publicationError("GENERATION_PNG_INVALID", "Publication PNG chunk exceeds file size")
    }
    if (type === "IDAT") hasIdat = true
    if (type === "IEND") {
      hasIend = true
      if (length !== 0 || nextOffset !== bytes.length) {
        throw publicationError("GENERATION_PNG_INVALID", "Publication PNG end chunk is invalid")
      }
    }
    if (["iTXt", "tEXt", "zTXt"].includes(type)) {
      sensitiveMetadataHits += countSensitiveText(
        bytes.subarray(dataStart, dataStart + length).toString("utf8"),
      )
    }
    offset = nextOffset
  }
  if (!hasIdat || !hasIend) {
    throw publicationError("GENERATION_PNG_INVALID", "Publication PNG content is incomplete")
  }
  return { sensitiveMetadataHits }
}

function countSensitiveText(text) {
  return sensitivePatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
}

function assertCurrentGenerationTimestamp(generatedAt) {
  const timestamp = Date.parse(generatedAt)
  const age = Date.now() - timestamp
  if (age < -5 * 60_000 || age > 24 * 60 * 60_000) {
    throw publicationError("GENERATION_METADATA_STALE", "Publication generation metadata is stale")
  }
}

async function readCurrentSourceBinding(repoRoot, sourcePaths) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    throw publicationError("GENERATION_SOURCE_INVALID", "Publication source paths are required")
  }
  const sorted = [...sourcePaths].sort()
  if (
    new Set(sorted).size !== sorted.length ||
    JSON.stringify(sorted) !== JSON.stringify(sourcePaths)
  ) {
    throw publicationError("GENERATION_SOURCE_INVALID", "Publication source paths are not exact")
  }
  const canonicalRepoRoot = await realpath(repoRoot)
  const files = []
  for (const sourcePath of sorted) {
    const filePath = resolveSourcePath(canonicalRepoRoot, sourcePath)
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw publicationError(
        "GENERATION_SOURCE_INVALID",
        "Publication source is not a regular file",
      )
    }
    const actualPath = await realpath(filePath)
    const actualRelative = path.relative(canonicalRepoRoot, actualPath)
    if (actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) {
      throw publicationError(
        "GENERATION_SOURCE_INVALID",
        "Publication source resolves outside repo",
      )
    }
    files.push({ path: sourcePath, sha256: sha256(await readFile(filePath)) })
  }
  return {
    aggregateSha256: sourceAggregateSha256(files),
    files,
  }
}

async function validateCurrentSourceBinding(repoRoot, binding) {
  const paths = binding.files.map(({ path: sourcePath }) => sourcePath)
  const current = await readCurrentSourceBinding(repoRoot, paths)
  if (JSON.stringify(binding) !== JSON.stringify(current)) {
    throw publicationError("GENERATION_SOURCE_STALE", "Publication source binding is stale")
  }
}

function resolveSourcePath(repoRoot, sourcePath) {
  if (path.isAbsolute(sourcePath) || sourcePath.includes("\0")) {
    throw publicationError("GENERATION_SOURCE_INVALID", "Publication source path is invalid")
  }
  const resolved = path.resolve(repoRoot, sourcePath)
  const relative = path.relative(repoRoot, resolved)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw publicationError("GENERATION_SOURCE_INVALID", "Publication source path escapes repo")
  }
  return resolved
}

async function assertPublicationDirectory(directory) {
  const stats = await lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o777) !== 0o700) {
    throw publicationError(
      "GENERATION_DIRECTORY_UNSAFE",
      "Publication generation directory is unsafe",
    )
  }
  assertOwnedByCurrentUser(stats, "Publication generation directory")
}

async function assertPublicationFile(filePath) {
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o777) !== 0o600) {
    throw publicationError("GENERATION_FILE_UNSAFE", "Publication generation file is unsafe")
  }
  assertOwnedByCurrentUser(stats, "Publication generation file")
}

function pngAggregateSha256(pngs) {
  return sha256(pngs.map(({ name, sha256: hash }) => `${hash}  ${name}\n`).join(""))
}

function sourceAggregateSha256(files) {
  return sha256(
    files.map(({ path: sourcePath, sha256: hash }) => `${hash}  ${sourcePath}\n`).join(""),
  )
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function publicationError(code, message, cause) {
  const error = new ProfileEditPublicationError(code, message)
  if (cause) error.cause = cause
  return error
}

async function rollbackDefaultPublication({ finalDir, quarantineDir, quarantined, stagingDir }) {
  if (quarantined && !(await maybeLstat(finalDir)) && (await maybeLstat(quarantineDir))) {
    await rename(quarantineDir, finalDir)
  }
  if (await maybeLstat(stagingDir)) await removeByLstat(stagingDir)
}

async function removeByLstat(candidatePath) {
  const stats = await maybeLstat(candidatePath)
  if (!stats) return
  if (stats.isSymbolicLink() || stats.isFile()) {
    await unlink(candidatePath)
    return
  }
  if (stats.isDirectory()) {
    await rm(candidatePath, { recursive: true })
    return
  }
  await unlink(candidatePath)
}

async function maybeLstat(candidatePath) {
  try {
    return await lstat(candidatePath)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function assertOwnedDirectory(directory, label) {
  const stats = await lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory`)
  }
  assertOwnedByCurrentUser(stats, label)
  if ((stats.mode & 0o777) !== 0o700) await chmod(directory, 0o700)
}

function assertOwnedByCurrentUser(stats, label) {
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current user`)
  }
}

async function assertNoSymlinkAncestors(rootPath, targetPath) {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Visual directory must not escape its owner root")
  }
  if (!relative) return
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stats = await maybeLstat(current)
    if (!stats) return
    if (stats.isSymbolicLink()) throw new Error("Visual directory must not contain symlinks")
  }
}
