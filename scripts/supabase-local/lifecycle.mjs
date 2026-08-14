import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { writeRedactedJson } from "../../tests/supabase-e2e/evidence-redaction.mjs"
import { readInstallAuthorization } from "./authorization.mjs"
import {
  DIRECT_TRIGGER,
  INSTALL_AUTHORIZATION_PATH,
  RUNTIME_DIRS,
  RUNTIME_LOCK_FILENAME,
  RUNTIME_RECEIPT_PATH,
  statusArgs,
  stopArgs,
  testDbArgs,
} from "./constants.mjs"
import {
  assertDockerDaemonIdentity,
  assertZeroResources,
  ensureDockerDesktop,
  installDockerDesktop,
  runDoctor,
  scanProjectResources,
  waitForDockerUnavailable,
} from "./docker.mjs"
import { createDockerEnv } from "./env.mjs"
import { runtimeLockPath, withRuntimeLock } from "./lock.mjs"
import {
  createRuntimeReceipt,
  maybeReadRuntimeReceipt,
  readRuntimeReceipt,
  removeOwnedRuntimeDirs,
  requireCurrentRuntimeReceipt,
  writeRuntimeReceipt,
  zeroResourcePathForReceipt,
} from "./receipt.mjs"
import { buildSupabaseSpawn, runRequired, runSpawn } from "./spawn.mjs"
import {
  assertSafeLocalConfig,
  parseSupabaseStatus,
  validateLocalSupabaseStatus,
} from "./status-config.mjs"
import { absoluteEvidencePath, siblingEvidencePath } from "./utils.mjs"

const STALE_LOCK_ORPHAN_RUNTIME_DIRS = ["supabase/.temp", "supabase/.branches"]

export async function runStart(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const receiptPath = options.receiptPath ?? absoluteEvidencePath(RUNTIME_RECEIPT_PATH)
  const defaultLockPath = runtimeLockPath(receiptPath)
  const lockPath = options.lockPath ?? defaultLockPath
  return withRuntimeLock(lockPath, (lockContext) =>
    runStartWithLock({
      ...options,
      lockContext,
      lockPath,
      repoRoot,
      receiptPath,
      staleLockOrphanCleanupAllowed: lockPath === defaultLockPath,
    }),
  )
}

export async function runStop({
  repoRoot = process.cwd(),
  env = process.env,
  runId,
  dockerOwnership,
  spawnRunner = runSpawn,
  resourceScanner = scanProjectResources,
  portChecker,
  receiptPath = absoluteEvidencePath(RUNTIME_RECEIPT_PATH),
  zeroResourcesPath,
} = {}) {
  const receipt = await readRuntimeReceipt(receiptPath)
  if (runId && receipt.runId !== runId) {
    throw new Error("Stale runtime receipt runId")
  }
  if (dockerOwnership && dockerOwnership !== receipt.dockerOwnership) {
    throw new Error("Docker ownership override does not match runtime receipt")
  }
  await runRequired(spawnRunner, buildSupabaseSpawn(stopArgs, { repoRoot, env }))
  await removeOwnedRuntimeDirs(repoRoot, receipt)
  const resources = await resourceScanner()
  assertZeroResources(resources)
  if (
    portChecker &&
    !(await portChecker([...receipt.supabasePorts, ...receipt.selectedNextPorts]))
  ) {
    throw new Error("Supabase ports are still in use after stop")
  }
  const resolvedZeroResourcesPath = zeroResourcesPath ?? zeroResourcePathForReceipt(receiptPath)
  if (["task-started", "task-installed"].includes(receipt.dockerOwnership)) {
    await maybeQuitTaskOwnedDocker({
      receipt,
      env,
      spawnRunner,
      zeroResourcesPath: resolvedZeroResourcesPath,
    })
  } else {
    await rm(resolvedZeroResourcesPath, { force: true })
  }
  return { stopped: true, dockerOwnership: receipt.dockerOwnership }
}

export async function runReset(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const env = options.env ?? process.env
  const spawnRunner = options.spawnRunner ?? runSpawn
  await requireCurrentRuntimeReceipt(options)
  const projectId = await assertSafeLocalConfig(repoRoot)
  await ensureLocalStarted({ ...options, repoRoot, env, spawnRunner, projectId })
  const status = await runSupabaseStatus({ repoRoot, env, spawnRunner, projectId })
  validateLocalSupabaseStatus({ projectId, apiUrl: status.apiUrl, dbUrl: status.dbUrl })
  await runRequired(
    spawnRunner,
    buildSupabaseSpawn(["db", "reset", "--local", "--no-seed"], { repoRoot, env }),
  )
  return status.redacted
}

export async function runStatus({
  repoRoot = process.cwd(),
  env = process.env,
  spawnRunner = runSpawn,
} = {}) {
  const status = await runSupabaseStatus({ repoRoot, env, spawnRunner })
  return status.redacted
}

export async function runTestDb({
  repoRoot = process.cwd(),
  env = process.env,
  spawnRunner = runSpawn,
  receiptPath = absoluteEvidencePath(RUNTIME_RECEIPT_PATH),
  runId,
} = {}) {
  await requireCurrentRuntimeReceipt({ receiptPath, runId })
  const projectId = await assertSafeLocalConfig(repoRoot)
  await runSupabaseStatus({ repoRoot, env, spawnRunner, projectId })
  await runRequired(spawnRunner, buildSupabaseSpawn(testDbArgs, { repoRoot, env }))
}

export function assertDirectTrigger(command) {
  if (command !== DIRECT_TRIGGER)
    throw new Error("Docker installation requires the direct start-work command")
  return command
}

async function runStartWithLock(options) {
  const { repoRoot, receiptPath } = options
  const env = options.env ?? process.env
  const spawnRunner = options.spawnRunner ?? runSpawn
  const existingReceipt = await maybeReadRuntimeReceipt(receiptPath)
  const runId = options.runId ?? existingReceipt?.runId ?? `spolink-${randomUUID()}`
  await removeStaleLockOrphanRuntimeDirs(repoRoot, options)
  await assertNoPreexistingRuntimeState(repoRoot)
  await assertNoExistingProjectResources(options.resourceScanner ?? scanProjectResources)
  const docker = await ensureDockerDesktop({
    ...options,
    env,
    spawnRunner,
    existingDockerOwnership: existingReceipt?.dockerOwnership,
  })
  const resolvedDocker = await resolveDockerOwnership({
    docker,
    runId,
    receiptPath,
    env,
    spawnRunner,
  })
  await writeRuntimeReceipt(
    receiptPath,
    createRuntimeReceipt({
      runId,
      dockerOwnership: resolvedDocker.ownership,
      dockerOwnershipProof: resolvedDocker.proof ? { runId, ...resolvedDocker.proof } : null,
      ownedRuntimeDirs: { runId, paths: RUNTIME_DIRS },
      createdAt: new Date().toISOString(),
    }),
  )
  await runRequired(spawnRunner, buildSupabaseSpawn(["start"], { repoRoot, env }))
  const status = await runSupabaseStatus({ repoRoot, env, spawnRunner })
  return { runId, dockerOwnership: resolvedDocker.ownership, status: status.redacted }
}

async function resolveDockerOwnership({ docker, runId, receiptPath, env, spawnRunner }) {
  if (docker.ownership !== "needs-install") {
    return docker
  }
  const authorization = await readInstallAuthorization(
    siblingEvidencePath(receiptPath, INSTALL_AUTHORIZATION_PATH),
  )
  if (authorization.runId !== runId) {
    throw new Error("Docker install authorization runId does not match runtime receipt")
  }
  return { ownership: "task-installed", proof: await installDockerDesktop({ env, spawnRunner }) }
}

async function maybeQuitTaskOwnedDocker({ receipt, env, spawnRunner, zeroResourcesPath }) {
  if (!receipt.dockerOwnershipProof || receipt.dockerOwnershipProof.runId !== receipt.runId) {
    throw new Error("Task-owned Docker quit requires current-run ownership proof")
  }
  await runDoctor({ env, spawnRunner })
  await assertDockerDaemonIdentity({
    expectedIdentity: receipt.dockerOwnershipProof.daemonIdentity,
    env,
    spawnRunner,
  })
  await writeRedactedJson(
    zeroResourcesPath,
    {
      schemaVersion: 1,
      runId: receipt.runId,
      containers: 0,
      volumes: 0,
      networks: 0,
      portsFree: true,
    },
    [],
  )
  await runRequired(spawnRunner, {
    command: "osascript",
    args: ["-e", 'quit app "Docker"'],
    options: { shell: false, env: createDockerEnv(env) },
    timeoutMs: 15_000,
  })
  await waitForDockerUnavailable({ env, spawnRunner, timeoutMs: 60_000 })
}

async function ensureLocalStarted(options) {
  const result = await options.spawnRunner(buildSupabaseSpawn(statusArgs, options))
  if (result.exitCode !== 0) {
    await runStart(options)
    return
  }
  parseSupabaseStatus(result.stdout, { projectId: options.projectId })
}

async function runSupabaseStatus({ repoRoot, env, spawnRunner, projectId }) {
  const result = await runRequired(spawnRunner, buildSupabaseSpawn(statusArgs, { repoRoot, env }))
  return parseSupabaseStatus(result.stdout, { projectId })
}

async function assertNoPreexistingRuntimeState(repoRoot) {
  for (const rel of RUNTIME_DIRS) {
    if (existsSync(path.join(repoRoot, rel))) {
      throw new Error(`Preexisting Supabase runtime state is not owned by this task: ${rel}`)
    }
  }
}

async function removeStaleLockOrphanRuntimeDirs(repoRoot, options) {
  if (!options.staleLockOrphanCleanupAllowed || !options.lockContext?.recoveredStaleLock) {
    return
  }
  assertStaleLockOrphanRuntimeDirScope(repoRoot, options.lockPath)
  for (const rel of STALE_LOCK_ORPHAN_RUNTIME_DIRS) {
    await rm(path.join(repoRoot, rel), { recursive: true, force: true })
  }
}

function assertStaleLockOrphanRuntimeDirScope(repoRoot, lockPath) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new Error("Stale runtime directory cleanup requires a repo root")
  }
  if (path.basename(lockPath) !== RUNTIME_LOCK_FILENAME) {
    throw new Error("Stale runtime directory cleanup requires the guarded runtime lock")
  }
  const repoRootPath = path.resolve(repoRoot)
  for (const rel of STALE_LOCK_ORPHAN_RUNTIME_DIRS) {
    if (!RUNTIME_DIRS.includes(rel)) {
      throw new Error(`Unexpected stale runtime cleanup dir: ${rel}`)
    }
    const target = path.resolve(repoRootPath, rel)
    if (path.isAbsolute(rel) || !target.startsWith(`${repoRootPath}${path.sep}`)) {
      throw new Error(`Unsafe stale runtime cleanup dir: ${rel}`)
    }
  }
}

async function assertNoExistingProjectResources(resourceScanner) {
  const resources = await resourceScanner()
  if (resources.containers.length + resources.volumes.length + resources.networks.length !== 0) {
    throw new Error("Preexisting Supabase Docker resources for project spolink are unowned")
  }
}
