import { mkdir, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { sha256, writeJsonMode600 } from "./process.mjs"

const terminalReceiptName = "task-7-evidence-closure-receipt.json"

export async function writeProfileEditTerminalReceipt({ outputPath, visualDir }) {
  const manifestPath = path.resolve(outputPath)
  const visualPath = path.resolve(visualDir)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const supportDir = path.join(path.dirname(manifestPath), "support")
  const receiptPath = path.join(supportDir, terminalReceiptName)
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    type: "task-7-terminal-closure-receipt",
    manifest: {
      mode: await fileMode(manifestPath),
      path: path.relative(process.cwd(), manifestPath),
      selfHash: manifest.selfHash?.value ?? null,
      sha256: sha256(await readFile(manifestPath)),
      verdict: manifest.verdict,
    },
    support: await collectSupportFiles(supportDir, receiptPath),
    visual: await collectVisualFiles(visualPath),
    verdict: manifest.verdict === "APPROVE" ? "APPROVE" : "REJECT",
  }
  await mkdir(supportDir, { mode: 0o700, recursive: true })
  await writeJsonMode600(receiptPath, {
    ...evidence,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(JSON.stringify(evidence)),
    },
  })
  return receiptPath
}

async function collectSupportFiles(supportDir, receiptPath) {
  const entries = await readDirectoryIfPresent(supportDir)
  return Promise.all(
    entries
      .filter((name) => path.join(supportDir, name) !== receiptPath)
      .map(async (name) => fileBinding(path.join(supportDir, name), supportDir)),
  )
}

async function collectVisualFiles(visualDir) {
  const entries = await readDirectoryIfPresent(visualDir)
  return Promise.all(
    entries.map(async (name) => fileBinding(path.join(visualDir, name), visualDir)),
  )
}

async function fileBinding(filePath, rootDir) {
  return {
    mode: await fileMode(filePath),
    name: path.relative(rootDir, filePath),
    sha256: sha256(await readFile(filePath)),
  }
}

async function fileMode(filePath) {
  return ((await stat(filePath)).mode & 0o777).toString(8).padStart(3, "0")
}

async function readDirectoryIfPresent(directory) {
  try {
    return (await readdir(directory)).sort()
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}
