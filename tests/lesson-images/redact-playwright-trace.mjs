import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import {
  decodeRedactableText,
  discoverTraceSecrets,
  encodeRedactableText,
  sanitizeTraceText,
} from "./playwright-trace-redaction-text.mjs"
import { independentlyScanExtractedTrace } from "./playwright-trace-security-scan.mjs"

const execFileAsync = promisify(execFile)

export async function redactPlaywrightTrace(tracePath, secrets = []) {
  const resolvedTracePath = path.resolve(tracePath)
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "spolink-trace-redact-"))
  const verificationDirectory = await mkdtemp(path.join(tmpdir(), "spolink-trace-verify-"))
  const outputPath = `${resolvedTracePath}.${randomUUID()}.redacted.zip`
  const normalizedSecrets = [...new Set(secrets.filter((secret) => secret.length > 0))]
  try {
    await validateArchivePaths(resolvedTracePath)
    await execFileAsync("unzip", ["-q", resolvedTracePath, "-d", temporaryDirectory])
    const preSanitizationScan = await independentlyScanExtractedTrace(
      temporaryDirectory,
      normalizedSecrets,
    )
    const files = await collectRegularFiles(temporaryDirectory)
    const binaryDigests = new Map()
    const textEntries = []
    let changedTextEntries = 0
    let textualEntries = 0
    for (const file of files) {
      const bytes = await readFile(file)
      const decoded = decodeRedactableText(bytes)
      const relativePath = path.relative(temporaryDirectory, file)
      if (decoded === null) {
        binaryDigests.set(relativePath, sha256(bytes))
        continue
      }
      textualEntries += 1
      textEntries.push({ decoded, file })
    }
    const discoveredSecrets = discoverTraceSecrets(
      textEntries.map((entry) => entry.decoded.text),
      normalizedSecrets,
    )
    for (const entry of textEntries) {
      const sanitized = sanitizeTraceText(entry.decoded.text, discoveredSecrets)
      if (sanitized !== entry.decoded.text) changedTextEntries += 1
      await writeFile(entry.file, encodeRedactableText(entry.decoded, sanitized), { mode: 0o600 })
    }
    await execFileAsync("zip", ["-q", "-r", outputPath, "."], { cwd: temporaryDirectory })
    await execFileAsync("unzip", ["-tqq", outputPath])
    await execFileAsync("unzip", ["-q", outputPath, "-d", verificationDirectory])
    await verifyBinaryEntries(verificationDirectory, binaryDigests)
    const independentScan = await independentlyScanExtractedTrace(
      verificationDirectory,
      normalizedSecrets,
    )
    if (independentScan.forbiddenPatternMatches !== 0) {
      throw new Error(
        `Sanitized Playwright trace failed the independent security scan: ${JSON.stringify(independentScan.matchesByCategory)}`,
      )
    }
    await rename(outputPath, resolvedTracePath)
    const bytes = await readFile(resolvedTracePath)
    return {
      binaryEntriesPreserved: binaryDigests.size,
      changedTextEntries,
      entriesScanned: files.length,
      forbiddenPatternMatches: independentScan.forbiddenPatternMatches,
      independentScan,
      preSanitizationForbiddenPatternMatches: preSanitizationScan.forbiddenPatternMatches,
      sha256: sha256(bytes),
      textualEntriesProcessed: textualEntries,
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
    await rm(verificationDirectory, { force: true, recursive: true })
    await rm(outputPath, { force: true })
  }
}

async function validateArchivePaths(tracePath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", tracePath])
  for (const entry of stdout.split(/\r?\n/u).filter(Boolean)) {
    const normalized = entry.replaceAll("\\", "/")
    if (
      path.posix.isAbsolute(normalized) ||
      normalized.split("/").some((segment) => segment === "..")
    ) {
      throw new Error("Playwright trace contains an unsafe archive path")
    }
  }
}

async function collectRegularFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectRegularFiles(target)))
    else if (entry.isFile()) files.push(target)
    else throw new Error("Playwright trace contains a non-regular entry")
  }
  return files
}

async function verifyBinaryEntries(directory, expectedDigests) {
  for (const [relativePath, expectedDigest] of expectedDigests) {
    const actualDigest = sha256(await readFile(path.join(directory, relativePath)))
    if (actualDigest !== expectedDigest) {
      throw new Error("Playwright trace binary entry changed during sanitization")
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
