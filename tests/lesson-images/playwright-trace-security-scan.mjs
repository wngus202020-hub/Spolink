import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { scanSecurityText, securityCategories } from "./trace-linear-security-scan.mjs"

const execFileAsync = promisify(execFile)

export async function independentlyScanPlaywrightTrace(tracePath, forbiddenValues = []) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "spolink-trace-scan-"))
  try {
    await execFileAsync("unzip", ["-q", path.resolve(tracePath), "-d", temporaryDirectory])
    return await independentlyScanExtractedTrace(temporaryDirectory, forbiddenValues)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

export async function independentlyScanExtractedTrace(directory, forbiddenValues = []) {
  const files = await collectRegularFiles(directory)
  const matchesByCategory = Object.fromEntries(securityCategories.map((category) => [category, 0]))
  let binaryEntries = 0
  let textualEntries = 0
  for (const file of files) {
    const source = decodeScannableText(await readFile(file))
    if (source === null) {
      binaryEntries += 1
      continue
    }
    textualEntries += 1
    const scan = independentlyScanText(source, forbiddenValues)
    for (const [category, count] of Object.entries(scan.matchesByCategory)) {
      matchesByCategory[category] += count
    }
  }
  return {
    binaryEntries,
    entriesScanned: files.length,
    forbiddenPatternMatches: Object.values(matchesByCategory).reduce(
      (total, count) => total + count,
      0,
    ),
    matchesByCategory,
    textualEntries,
  }
}

export function independentlyScanText(source, forbiddenValues = []) {
  const matchesByCategory = scanSecurityText(source, forbiddenValues)
  return {
    forbiddenPatternMatches: Object.values(matchesByCategory).reduce(
      (total, count) => total + count,
      0,
    ),
    matchesByCategory,
  }
}

async function collectRegularFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectRegularFiles(target)))
    else if (entry.isFile()) files.push(target)
  }
  return files
}

export function decodeScannableText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return validText(bytes.subarray(2).toString("utf16le"))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return validText(decodeUtf16Be(bytes.subarray(2)))
  }
  const inferred = inferUtf16(bytes)
  if (inferred === "le") return validText(bytes.toString("utf16le"))
  if (inferred === "be") return validText(decodeUtf16Be(bytes))
  try {
    const offset =
      bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0
    return validText(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset)))
  } catch {
    return null
  }
}

function validText(source) {
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null
  }
  return source
}

function inferUtf16(bytes) {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return null
  let evenZeros = 0
  let oddZeros = 0
  const pairs = Math.min(bytes.length / 2, 512)
  for (let index = 0; index < pairs * 2; index += 2) {
    if (bytes[index] === 0) evenZeros += 1
    if (bytes[index + 1] === 0) oddZeros += 1
  }
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.1) return "le"
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.1) return "be"
  return null
}

function decodeUtf16Be(bytes) {
  const copy = Buffer.from(bytes)
  for (let index = 0; index < copy.length; index += 2) {
    ;[copy[index], copy[index + 1]] = [copy[index + 1], copy[index]]
  }
  return copy.toString("utf16le")
}
