import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { Task3EvidenceError, task3HeadPattern, task3Sha256 } from "./task3-evidence-validation.mjs"
import {
  generatedNextEnvMarker,
  generatedNextEnvPath,
  generatedSupabaseBranchMarker,
  generatedSupabaseBranchPath,
  normalizeGeneratedNextEnvStatus,
  normalizeGeneratedSupabaseBranchStatus,
  readValidatedGeneratedNextEnv,
  readValidatedGeneratedSupabaseBranch,
  revalidateGeneratedNextEnv,
  revalidateGeneratedSupabaseBranch,
  validateGeneratedNextEnvIndex,
} from "./task3-generated-state.mjs"

const execFileAsync = promisify(execFile)

export async function computeTask3SourceBinding(repoRoot = process.cwd(), options = {}) {
  const [
    { stdout: headOutput },
    { stdout: inventoryOutput },
    { stdout: statusOutput },
    { stdout: indexNextEnv },
    { stdout: indexNextEnvEntry },
    generatedNextEnv,
    generatedSupabaseBranch,
  ] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }),
    execFileAsync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    }),
    execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all", "-z"], {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    }),
    execFileAsync("git", ["show", `:${generatedNextEnvPath}`], {
      cwd: repoRoot,
      encoding: "buffer",
    }),
    execFileAsync("git", ["ls-files", "-s", "--", generatedNextEnvPath], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
    readValidatedGeneratedNextEnv(repoRoot),
    readValidatedGeneratedSupabaseBranch(repoRoot),
  ])
  const head = headOutput.trim()
  if (!task3HeadPattern.test(head))
    throw new Task3EvidenceError("Current HEAD is not a full commit SHA")
  const files = new Set(inventoryOutput.toString("utf8").split("\0").filter(Boolean))
  files.add(generatedSupabaseBranchPath)
  const manifestHash = createHash("sha256")
  for (const relativePath of [...files].sort((left, right) => left.localeCompare(right))) {
    manifestHash.update(relativePath)
    manifestHash.update("\0")
    manifestHash.update(
      relativePath === generatedNextEnvPath
        ? generatedNextEnvMarker
        : relativePath === generatedSupabaseBranchPath
          ? generatedSupabaseBranchMarker
          : await hashInventoryEntry(
              path.join(repoRoot, relativePath),
              relativePath,
              options.afterInventoryEntryOpen,
            ),
    )
    manifestHash.update("\n")
  }
  const indexSchema = validateGeneratedNextEnvIndex(indexNextEnvEntry, indexNextEnv)
  const normalizedStatus = normalizeGeneratedSupabaseBranchStatus(
    normalizeGeneratedNextEnvStatus(statusOutput, indexSchema, generatedNextEnv.schema),
    generatedSupabaseBranch,
  )
  await Promise.all([
    revalidateGeneratedNextEnv(repoRoot, generatedNextEnv),
    revalidateGeneratedSupabaseBranch(repoRoot, generatedSupabaseBranch),
  ])
  return {
    head,
    manifestSha256: manifestHash.digest("hex"),
    statusSha256: task3Sha256(normalizedStatus),
  }
}

async function hashInventoryEntry(filePath, relativePath, afterInventoryEntryOpen) {
  try {
    const currentUid = readCurrentInventoryUid()
    const before = await lstat(filePath, { bigint: true })
    await afterInventoryEntryOpen?.({ relativePath })
    if (!before.isFile() || before.isSymbolicLink())
      throw new Task3EvidenceError(`Inventory entry must be a regular file: ${relativePath}`)
    requireCurrentInventoryOwner(before, currentUid, relativePath)
    let handle
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      const opened = await handle.stat({ bigint: true })
      requireCurrentInventoryOwner(opened, currentUid, relativePath)
      const body = await handle.readFile()
      const after = await handle.stat({ bigint: true })
      requireCurrentInventoryOwner(after, currentUid, relativePath)
      if (
        !isStableInventoryFile(before, opened) ||
        !isStableInventoryFile(opened, after) ||
        after.size !== BigInt(body.byteLength)
      )
        throw new Task3EvidenceError(`Inventory entry changed while binding: ${relativePath}`)
      return `file:${task3Sha256(body)}`
    } catch (error) {
      if (error?.code === "ELOOP")
        throw new Task3EvidenceError(`Inventory entry must be a regular file: ${relativePath}`)
      throw error
    } finally {
      await handle?.close()
    }
  } catch (error) {
    if (error?.code === "ENOENT") return "missing"
    throw error
  }
}

export function isStableInventoryFile(left, right) {
  return (
    right.isFile() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.gid === right.gid
  )
}

function readCurrentInventoryUid() {
  if (process.platform === "win32") return undefined
  if (typeof process.getuid !== "function")
    throw new Task3EvidenceError("POSIX source binding requires current-user ownership support")
  return BigInt(process.getuid())
}

function requireCurrentInventoryOwner(fileStat, currentUid, relativePath) {
  if (currentUid !== undefined && fileStat.uid !== currentUid)
    throw new Task3EvidenceError(
      `Inventory entry must be owned by the current user: ${relativePath}`,
    )
}
