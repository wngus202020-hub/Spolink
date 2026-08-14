import { constants } from "node:fs"
import { access, chmod, lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"

const evidenceDir = ".omo/evidence"
const defaultAuthOutputDir = ".omo/evidence/supabase-auth-ui-session-auth-outputs"
const defaultAuthEvidenceLog = ".omo/evidence/supabase-auth-ui-session.jsonl"
const defaultSupabaseOutputDir = ".omo/evidence/supabase-auth-ui-session-supabase-outputs"
const defaultSupabaseEvidenceLog =
  ".omo/evidence/supabase-auth-ui-session-supabase-regression.jsonl"

export async function requireEvidenceRoot(repoRoot = process.cwd()) {
  const repoRootReal = await realpath(repoRoot)
  const omoPath = path.join(repoRoot, ".omo")
  let omoStats
  try {
    omoStats = await lstat(omoPath)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    await mkdir(omoPath, { mode: 0o700 })
    omoStats = await lstat(omoPath)
  }
  if (omoStats.isSymbolicLink() || !omoStats.isDirectory()) {
    throw new Error(".omo must be a real directory")
  }
  const rootPath = path.join(repoRoot, evidenceDir)
  let stats
  try {
    stats = await lstat(rootPath)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    await mkdir(rootPath, { mode: 0o700 })
    stats = await lstat(rootPath)
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(".omo/evidence must be a real directory")
  }
  await chmod(rootPath, 0o700)
  const evidenceRootReal = await realpath(rootPath)
  const expectedRootReal = path.join(repoRootReal, evidenceDir)
  if (evidenceRootReal !== expectedRootReal) {
    throw new Error("Evidence root must remain inside the canonical repository")
  }
  return { evidenceRoot: rootPath, evidenceRootReal, repoRoot, repoRootReal }
}

export async function resolveEvidenceChildPath(inputPath, options = {}) {
  if (typeof inputPath !== "string" || inputPath.length === 0 || inputPath.includes("\0")) {
    throw new Error("Evidence path must be a non-empty string")
  }
  if (inputPath.includes("\\") || inputPath.split("/").includes("..")) {
    throw new Error("Evidence path must not escape .omo/evidence")
  }
  const context = await requireEvidenceRoot(options.repoRoot)
  const resolved = path.resolve(context.repoRoot, inputPath)
  assertInside(context.evidenceRoot, resolved)
  if (resolved === path.resolve(context.evidenceRoot)) {
    throw new Error("Evidence path must name a child of .omo/evidence")
  }
  if (options.suffix && !resolved.endsWith(options.suffix)) {
    throw new Error(`Evidence path must end with ${options.suffix}`)
  }
  const parent = options.kind === "directory" ? resolved : path.dirname(resolved)
  await assertNoSymlinkAncestors(context.evidenceRoot, parent)
  if (options.createParent !== false) await mkdir(parent, { mode: 0o700, recursive: true })
  await assertNoSymlinkAncestors(context.evidenceRoot, parent)
  if (options.kind === "directory") await assertDirectoryTarget(resolved)
  if (options.kind === "file") await assertFileTarget(resolved)
  return resolved
}

export async function resolveAuthOutputDir(repoRoot = process.cwd()) {
  return resolveEvidenceChildPath(process.env.SPOLINK_AUTH_E2E_OUTPUT_DIR ?? defaultAuthOutputDir, {
    kind: "directory",
    repoRoot,
  })
}

export async function resolveAuthEvidenceLog(repoRoot = process.cwd()) {
  return resolveEvidenceChildPath(
    process.env.SPOLINK_AUTH_E2E_EVIDENCE_LOG ?? defaultAuthEvidenceLog,
    { kind: "file", repoRoot, suffix: ".jsonl" },
  )
}

export async function resolveSupabaseOutputDir(repoRoot = process.cwd()) {
  return resolveEvidenceChildPath(process.env.SPOLINK_E2E_OUTPUT_DIR ?? defaultSupabaseOutputDir, {
    kind: "directory",
    repoRoot,
  })
}

export async function resolveSupabaseQaOutputDir(repoRoot = process.cwd()) {
  const outputDir = await resolveSupabaseOutputDir(repoRoot)
  return resolveEvidenceChildPath(
    process.env.SPOLINK_E2E_QA_OUTPUT_DIR ?? path.join(outputDir, "qa"),
    {
      kind: "directory",
      repoRoot,
    },
  )
}

export async function resolveSupabaseEvidenceLog(repoRoot = process.cwd()) {
  return resolveEvidenceChildPath(
    process.env.SPOLINK_E2E_EVIDENCE_LOG ?? defaultSupabaseEvidenceLog,
    { kind: "file", repoRoot, suffix: ".jsonl" },
  )
}

function assertInside(rootPath, childPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(childPath))
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Evidence path must be beneath .omo/evidence")
  }
}

async function assertNoSymlinkAncestors(rootPath, targetPath) {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  if (target === root) return
  assertInside(root, target)
  let current = root
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) throw new Error(`Evidence path contains symlink: ${current}`)
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }
  }
}

async function assertDirectoryTarget(targetPath) {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Evidence output directory must be a real directory")
    }
    await chmod(targetPath, 0o700)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    await mkdir(targetPath, { mode: 0o700, recursive: true })
  }
}

async function assertFileTarget(targetPath) {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Evidence log must be a real file")
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  await access(path.dirname(targetPath), constants.W_OK)
}
