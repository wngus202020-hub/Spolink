import { constants } from "node:fs"
import { lstat, open, readdir } from "node:fs/promises"
import path from "node:path"

import { isTask3SafeRelativePath, Task3EvidenceError, task3Sha256 } from "./task3-evidence.mjs"

const noFollowRead = constants.O_RDONLY | constants.O_NOFOLLOW
const generatedNames = new Set([
  "task-7-current-attempt-index.json",
  "task-7-evidence-hygiene.json",
  "artifacts/evidence-scan.json",
  "receipts/evidence-scan.json",
])
const textExtensions = new Set([
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".mjs",
  ".patch",
  ".sha256",
  ".tap",
  ".txt",
])
const findings = [
  ["authorization", /\bauthorization\s*[:=]\s*(?:bearer|basic)\s+(?!<redacted)[^\s"',;\\]{8,}/iu],
  ["cookie", /\b(?:set-cookie|cookie)\s*[:=]\s*(?!<redacted)[^\r\n]{6,}/iu],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u],
  [
    "provider-key",
    /\b(?:sb_(?:publishable|secret)|gh[pousr]|sk-(?:proj-)?|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/u,
  ],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  [
    "db-userinfo",
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/(?!<redacted-db-uri>@)[^/\s?#@]+@/iu,
  ],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
  ["phone", /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/u],
]

export const task3TerminalOutputPolicy = {
  excludedFromSealedReferencesOnly: true,
  paths: [
    "final-f1-plan-compliance.md",
    "final-f2-code-security.md",
    "final-f3-manual-qa.json",
    "final-f4-scope-fidelity.md",
    "task-7-independent-gate-review.md",
  ],
  requiredFileMode: "0600",
  requiredLinkCount: 1,
  requiredLocation: "attempt-root",
  verification: "descriptor-o_nofollow-fstat-sha256",
}

const terminalOutputNames = new Set(task3TerminalOutputPolicy.paths)

export async function inspectTask3Attempt(attemptRoot, hooks = {}) {
  const files = []
  const terminalOutputs = []

  async function visit(directory) {
    const directoryHandle = await openNode(directory, "evidence directory")
    try {
      const directoryStat = await directoryHandle.stat({ bigint: true })
      const pathStat = await lstat(directory, { bigint: true })
      requireDirectory(directoryStat, pathStat)
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const filePath = path.join(directory, entry.name)
        const relative = path.relative(attemptRoot, filePath).split(path.sep).join("/")
        if (!isTask3SafeRelativePath(relative))
          throw new Task3EvidenceError(`Unsafe evidence path: ${relative}`)
        if (entry.isSymbolicLink())
          throw new Task3EvidenceError(`Unsafe evidence symbolic link: ${relative}`)
        if (entry.isDirectory()) await visit(filePath)
        else if (entry.isFile()) {
          if (generatedNames.has(relative)) continue
          if (/(?:^|\/)(?:raw|temp|tmp)(?:[._-]|\/|$)/iu.test(relative))
            throw new Task3EvidenceError(`Raw temporary evidence is forbidden: ${relative}`)
          const snapshot = await snapshotEvidenceFile(filePath, relative, hooks)
          await inspectContent(relative, snapshot.body)
          const record = { relative, sha256: snapshot.sha256 }
          if (terminalOutputNames.has(relative))
            terminalOutputs.push({ mode: "0600", path: relative, sha256: snapshot.sha256 })
          else files.push(record)
        } else throw new Task3EvidenceError(`Unsafe evidence node: ${relative}`)
      }
      await requireDirectoryIdentity(directoryHandle, directory)
    } finally {
      await directoryHandle.close()
    }
  }

  await visit(attemptRoot)
  files.sort((left, right) => left.relative.localeCompare(right.relative))
  terminalOutputs.sort((left, right) => left.path.localeCompare(right.path))
  return { files, terminalOutputs }
}

async function snapshotEvidenceFile(filePath, relative, hooks) {
  const pathBefore = await lstat(filePath, { bigint: true })
  requirePrivateFile(pathBefore, relative)
  await hooks.beforeFileOpen?.(relative)
  const handle = await openNode(filePath, relative)
  try {
    const before = await handle.stat({ bigint: true })
    requirePrivateFile(before, relative)
    if (!sameNode(pathBefore, before))
      throw new Task3EvidenceError(`Evidence file changed before descriptor open: ${relative}`)
    const body = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    requirePrivateFile(after, relative)
    if (!sameIdentity(before, after) || BigInt(body.byteLength) !== after.size)
      throw new Task3EvidenceError(`Evidence file changed while being read: ${relative}`)
    const pathAfter = await lstat(filePath, { bigint: true })
    requirePrivateFile(pathAfter, relative)
    if (!sameNode(after, pathAfter))
      throw new Task3EvidenceError(`Evidence file path identity changed: ${relative}`)
    return { body, sha256: task3Sha256(body) }
  } finally {
    await handle.close()
  }
}

async function openNode(filePath, label) {
  try {
    return await open(filePath, noFollowRead)
  } catch (error) {
    if (error?.code === "ELOOP")
      throw new Task3EvidenceError(`Evidence node must not be a symbolic link: ${label}`)
    throw error
  }
}

function requireDirectory(descriptorStat, pathStat) {
  if (
    !descriptorStat.isDirectory() ||
    !pathStat.isDirectory() ||
    !sameNode(descriptorStat, pathStat)
  )
    throw new Task3EvidenceError("Unsafe evidence directory node")
  if ((descriptorStat.mode & 0o777n) !== 0o700n)
    throw new Task3EvidenceError("Evidence directory mode must be 0700")
}

async function requireDirectoryIdentity(handle, directory) {
  const descriptorStat = await handle.stat({ bigint: true })
  const pathStat = await lstat(directory, { bigint: true })
  requireDirectory(descriptorStat, pathStat)
}

function requirePrivateFile(fileStat, relative) {
  if (!fileStat.isFile())
    throw new Task3EvidenceError(`Evidence node must be a regular file: ${relative}`)
  if ((fileStat.mode & 0o777n) !== 0o600n)
    throw new Task3EvidenceError(`Evidence file mode must be 0600: ${relative}`)
  if (fileStat.nlink !== 1n)
    throw new Task3EvidenceError(`Evidence file must not be a hard link: ${relative}`)
  if (!isTask3FileOwnedByCurrentUid(fileStat, readCurrentUid()))
    throw new Task3EvidenceError(`Evidence file UID must match current process: ${relative}`)
}

export function isTask3FileOwnedByCurrentUid(fileStat, currentUid) {
  return currentUid === undefined || fileStat.uid === currentUid
}

function readCurrentUid() {
  if (typeof process.getuid === "function") return BigInt(process.getuid())
  if (process.platform !== "win32") return null
  return undefined
}

function sameNode(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameIdentity(left, right) {
  return sameNode(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs
}

async function inspectContent(relative, body) {
  const extension = path.extname(relative)
  if (!textExtensions.has(extension)) return
  if (body.includes(0)) throw new Task3EvidenceError(`NUL byte in textual evidence: ${relative}`)
  const text = body.toString("utf8")
  if (extension === ".json") parseJson(text, relative)
  if (extension === ".jsonl") {
    for (const [index, line] of text.split("\n").entries())
      if (line.trim()) parseJson(line, `${relative}:${index + 1}`)
  }
  for (const [category, pattern] of findings) {
    if (pattern.test(text))
      throw new Task3EvidenceError(`Sensitive evidence finding (${category}): ${relative}`)
  }
}

function parseJson(value, label) {
  try {
    JSON.parse(value)
  } catch {
    throw new Task3EvidenceError(`Malformed JSON evidence: ${label}`)
  }
}
