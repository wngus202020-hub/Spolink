import { createHash } from "node:crypto"
import { chmod, lstat, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const projects = ["mobile-chromium", "tablet-chromium", "desktop-chromium"]
const expectedHttpFailures = [
  { count: 3, routeCategory: "completion-page", status: 404 },
  { count: 1, routeCategory: "reservation-detail-page", status: 404 },
]
export const screenshotDescriptors = [
  ["completion-success-390.png", 390, 844],
  ["completion-recovery-390.png", 390, 844],
  ["completion-success-768.png", 768, 900],
  ["completion-recovery-768.png", 768, 900],
  ["completion-success-1280.png", 1280, 900],
  ["completion-recovery-1280.png", 1280, 900],
]
export const runIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u

export async function writeBundleManifest(bundlePath, summary) {
  const summaryPath = path.join(bundlePath, "focused-summary.json")
  const manifest = {
    runId: summary.runId,
    schemaVersion: 1,
    screenshots: summary.screenshots.map(({ name, sha256: hash }) => ({ name, sha256: hash })),
    sourceHashes: summary.sourceHashes,
    summarySha256: sha256(await readFile(summaryPath)),
  }
  await writeFile(
    path.join(bundlePath, "source-run-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  )
}

export async function validateBundle(bundlePath, runId) {
  const stats = await lstat(bundlePath)
  if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700) {
    throw new Error("Task 6 versioned evidence bundle is invalid")
  }
  const summary = await validatePublication(
    path.join(bundlePath, "screenshots"),
    path.join(bundlePath, "focused-summary.json"),
    true,
  )
  const manifestPath = path.join(bundlePath, "source-run-manifest.json")
  const manifestStats = await lstat(manifestPath)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (
    !manifestStats.isFile() ||
    manifestStats.isSymbolicLink() ||
    (manifestStats.mode & 0o777) !== 0o600 ||
    manifest.runId !== runId ||
    manifest.runId !== summary.runId ||
    manifest.summarySha256 !==
      sha256(await readFile(path.join(bundlePath, "focused-summary.json"))) ||
    JSON.stringify(manifest.sourceHashes) !== JSON.stringify(summary.sourceHashes)
  ) {
    throw new Error("Task 6 source/run manifest is invalid")
  }
}

export async function validatePublication(screenshotsDir, summaryPath, requireRunBinding) {
  const names = (await readdir(screenshotsDir)).sort()
  const expectedNames = screenshotDescriptors.map(([name]) => name).sort()
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("Task 6 screenshot publication inventory is incomplete")
  }
  const receipts = []
  for (const [name, width, height] of screenshotDescriptors) {
    const filePath = path.join(screenshotsDir, name)
    const stats = await lstat(filePath)
    const bytes = await readFile(filePath)
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.nlink !== 1 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(16) !== width ||
      bytes.readUInt32BE(20) !== height
    ) {
      throw new Error(`Task 6 screenshot publication is invalid: ${name}`)
    }
    await chmod(filePath, 0o600)
    receipts.push({ bytes: bytes.byteLength, height, name, sha256: sha256(bytes), width })
  }
  const summaryBytes = await readFile(summaryPath)
  assertRedacted(summaryBytes.toString("utf8"))
  const summary = JSON.parse(summaryBytes.toString("utf8"))
  if (
    summary?.schemaVersion !== 2 ||
    summary.exitCode !== 0 ||
    summary.verdict !== "APPROVE" ||
    summary.redaction !== "identifiers-and-secrets-omitted" ||
    !(
      (summary.rawOutput?.removed === true && summary.rawOutput?.retained === false) ||
      (summary.rawOutput?.removed === false && summary.rawOutput?.retained === true)
    ) ||
    JSON.stringify(summary.projects) !== JSON.stringify(projects) ||
    JSON.stringify(summary.screenshots) !== JSON.stringify(receipts)
  ) {
    throw new Error("Task 6 focused summary does not match the staged screenshots")
  }
  if (requireRunBinding) validateRunBinding(summary)
  assertBrowserReceipts(summary.browserReceipts, receipts)
  await chmod(summaryPath, 0o600)
  return summary
}

function validateRunBinding(summary) {
  if (!runIdPattern.test(summary.runId ?? "")) {
    throw new Error("Task 6 focused summary runId is invalid")
  }
  const entries = Object.entries(summary.sourceHashes ?? {})
  if (
    entries.length === 0 ||
    entries.some(
      ([name, hash]) =>
        path.isAbsolute(name) ||
        name.split(path.sep).includes("..") ||
        !/^[0-9a-f]{64}$/u.test(hash),
    )
  ) {
    throw new Error("Task 6 focused summary source hashes are invalid")
  }
}

function assertBrowserReceipts(browserReceipts, screenshots) {
  if (!Array.isArray(browserReceipts) || browserReceipts.length !== projects.length) {
    throw new Error("Task 6 browser receipt inventory is invalid")
  }
  const screenshotHashes = new Map(screenshots.map((item) => [item.name, item.sha256]))
  for (const [index, project] of projects.entries()) {
    const receipt = browserReceipts[index]
    assertBrowserDiagnosticsReceipt(receipt?.browserDiagnostics)
    if (
      receipt?.project !== project ||
      receipt.cleanup !== "completed" ||
      receipt.forbiddenRequestCount !== 0 ||
      receipt.download?.bytes <= 0 ||
      !/^[0-9a-f]{64}$/u.test(receipt.download?.sha256 ?? "") ||
      !Array.isArray(receipt.screenshots) ||
      receipt.screenshots.length !== 2 ||
      receipt.screenshots.some((item) => screenshotHashes.get(item.name) !== item.sha256)
    ) {
      throw new Error(`Task 6 browser receipt is invalid: ${project}`)
    }
  }
}

export function assertBrowserDiagnosticsReceipt(receipt) {
  const unexpected = receipt?.unexpected
  if (
    !receipt ||
    Object.keys(receipt).sort().join(",") !==
      "consoleWarningCount,expectedHttpFailures,expectedNavigationAbortCount,unexpected" ||
    !Number.isSafeInteger(receipt.consoleWarningCount) ||
    receipt.consoleWarningCount < 0 ||
    receipt.expectedNavigationAbortCount !== 1 ||
    JSON.stringify(receipt.expectedHttpFailures) !== JSON.stringify(expectedHttpFailures) ||
    !unexpected ||
    Object.keys(unexpected).sort().join(",") !==
      "consoleError,httpResponse,pageError,requestFailed" ||
    Object.values(unexpected).some((count) => count !== 0)
  ) {
    throw new Error("Task 11 browser diagnostics receipt is invalid")
  }
}

function assertRedacted(value) {
  const forbidden = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    /(?:postgres(?:ql)?):\/\/[^\s]+/iu,
    /(?:Bearer\s+|eyJ)[A-Za-z0-9._-]+/u,
    /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/u,
  ]
  if (forbidden.some((pattern) => pattern.test(value))) {
    throw new Error("Task 6 focused summary contains a forbidden identity or secret")
  }
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
