import { createHash } from "node:crypto"
import path from "node:path"

export const shaPattern = /^[a-f0-9]{64}$/

export const evidenceFields = Object.freeze([
  "schemaVersion",
  "timestamp",
  "entryType",
  "command",
  "exitCode",
  "redactedOutputPath",
  "redactedOutputSha256",
  "db",
  "http",
  "cleanup",
  "verdict",
])

export function createVerifierContext(overrides = {}) {
  return {
    evidenceRoot: overrides.evidenceRoot ?? ".omo/evidence",
    repoRoot: overrides.repoRoot ?? process.cwd(),
    runSecretScan: overrides.runSecretScan ?? true,
  }
}

export function repoPath(context, repoRelativePath) {
  return path.join(context.repoRoot, repoRelativePath)
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
