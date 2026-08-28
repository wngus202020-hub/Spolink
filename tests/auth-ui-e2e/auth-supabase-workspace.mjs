import { createHash } from "node:crypto"
import { cp, lstat, mkdir, open, readFile, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assertAuthConfigDelta, rewriteAuthConfig } from "./auth-config-schema.mjs"
import { createOwnedTempRoot } from "./owned-temp-root.mjs"

const configPath = "supabase/config.toml"

export async function createAuthSupabaseWorkspace({
  baseUrl,
  enableConfirmations,
  lockPath = path.join(os.tmpdir(), "spolink-auth-supabase-workspace.lock"),
  repoRoot = process.cwd(),
}) {
  const lock = await acquireLock(lockPath)
  let owner
  let project
  try {
    owner = await createOwnedTempRoot({ prefix: "spolink-auth-supabase-" })
    project = await owner.createDirectory("project")
    const supabaseDir = path.join(project.path, "supabase")
    await mkdir(path.join(project.path, ".omo/evidence"), { mode: 0o700, recursive: true })
    await mkdir(supabaseDir, { mode: 0o700 })

    const sourceConfigPath = path.join(repoRoot, configPath)
    const sourceBefore = await immutableFileIdentity(sourceConfigPath)
    const sourceText = sourceBefore.bytes.toString("utf8")
    const externalText = rewriteAuthConfig(sourceText, { baseUrl, enableConfirmations })
    assertAuthConfigDelta(sourceText, externalText, { baseUrl, enableConfirmations })
    const externalConfigPath = path.join(supabaseDir, "config.toml")
    await writeFile(externalConfigPath, externalText, { mode: 0o600 })
    await copyIfPresent(
      path.join(repoRoot, "supabase/migrations"),
      path.join(supabaseDir, "migrations"),
    )
    await copyIfPresent(
      path.join(repoRoot, "supabase/seed.sql"),
      path.join(supabaseDir, "seed.sql"),
    )
    await writeWorkspacePackage(project.path, repoRoot)
    await copyIfPresent(
      path.join(repoRoot, "pnpm-lock.yaml"),
      path.join(project.path, "pnpm-lock.yaml"),
    )
    await symlink(path.join(repoRoot, "node_modules"), path.join(project.path, "node_modules"))
    await assertImmutableFileIdentity(sourceConfigPath, sourceBefore)
    await owner.sealDirectory(project)

    let cleanupPromise
    return {
      assertRepositoryConfigUnchanged() {
        return assertImmutableFileIdentity(sourceConfigPath, sourceBefore)
      },
      configPath: externalConfigPath,
      configSha256: sha256(externalText),
      repoConfigIdentity: sourceBefore,
      root: project.path,
      cleanup() {
        cleanupPromise ??= cleanupWorkspace({ lock, owner, project })
        return cleanupPromise
      },
    }
  } catch (error) {
    await cleanupFailedWorkspace({ lock, owner, project })
    throw error
  }
}

async function writeWorkspacePackage(root, repoRoot) {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
  packageJson.scripts = Object.fromEntries(
    ["start", "status", "reset", "stop", "assert-stopped"].map((command) => [
      `supabase:${command}`,
      `${process.execPath} ${path.join(repoRoot, "scripts/supabase-local.mjs")} ${command}`,
    ]),
  )
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, {
    mode: 0o600,
  })
}

async function acquireLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true })
  let handle
  try {
    handle = await open(lockPath, "wx", 0o600)
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Auth Supabase workspace ownership is already active or ambiguous")
    }
    throw error
  }
  await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`)
  await handle.chmod(0o600)
  return { handle, identity: await handle.stat(), path: lockPath }
}

async function releaseLock(lock) {
  const current = await lstat(lock.path)
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    current.dev !== lock.identity.dev ||
    current.ino !== lock.identity.ino ||
    current.nlink !== 1 ||
    (current.mode & 0o777) !== 0o600
  ) {
    throw new Error("Auth Supabase workspace lock ownership became ambiguous")
  }
  await lock.handle.close()
  const { rm } = await import("node:fs/promises")
  await rm(lock.path)
}

async function cleanupWorkspace({ lock, owner, project }) {
  await owner.remove(project)
  await owner.cleanup()
  await releaseLock(lock)
}

async function cleanupFailedWorkspace({ lock, owner, project }) {
  let cleanupError
  try {
    if (project) await owner.remove(project)
    if (owner) await owner.cleanup()
  } catch (error) {
    cleanupError = error
  }
  try {
    await releaseLock(lock)
  } catch (error) {
    cleanupError ??= error
  }
  if (cleanupError) throw cleanupError
}

async function immutableFileIdentity(filePath) {
  const stats = await lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Repository Supabase config must be a regular non-symlink file")
  }
  return { bytes: await readFile(filePath), dev: stats.dev, ino: stats.ino, mode: stats.mode }
}

async function assertImmutableFileIdentity(filePath, expected) {
  const current = await immutableFileIdentity(filePath)
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.mode !== expected.mode ||
    !current.bytes.equals(expected.bytes)
  ) {
    throw new Error("Repository Supabase config bytes, inode, or mode changed")
  }
}

async function copyIfPresent(source, destination) {
  try {
    await lstat(source)
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  await cp(source, destination, { errorOnExist: true, recursive: true })
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
