import process from "node:process"

import { PROJECT_ID, PROJECT_LABEL, PROJECT_RESOURCE_PATTERN } from "./constants.mjs"
import { createDockerEnv, findDockerAppPath } from "./env.mjs"
import { buildDockerSpawn, buildSupabaseSpawn, runRequired, runSpawn } from "./spawn.mjs"
import { delay, uniqueStrings } from "./utils.mjs"

export function parseDockerContextHost(output, env = process.env) {
  let parsed
  try {
    parsed = JSON.parse(output.trim())
  } catch (error) {
    throw new Error(`Docker context host must be JSON: ${error.message}`)
  }
  if (typeof parsed !== "string") {
    throw new Error("Docker context host JSON must decode to a string")
  }
  const allowedHomeSock = `unix://${env.HOME}/.docker/run/docker.sock`
  if (parsed !== allowedHomeSock && parsed !== "unix:///var/run/docker.sock") {
    throw new Error("Docker context is not an approved local Docker context")
  }
  return parsed
}

export function validateDockerDesktopProbe({ contextHost, operatingSystem, env = process.env }) {
  parseDockerContextHost(JSON.stringify(contextHost), env)
  if (typeof operatingSystem !== "string" || !operatingSystem.includes("Docker Desktop")) {
    throw new Error("Docker daemon must be Docker Desktop")
  }
  return operatingSystem.trim()
}

export async function runDoctor({
  repoRoot = process.cwd(),
  env = process.env,
  spawnRunner = runSpawn,
} = {}) {
  const context = await runRequired(
    spawnRunner,
    buildDockerSpawn(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], {
      env,
    }),
  )
  const contextHost = parseDockerContextHost(context.stdout, env)
  const os = await runRequired(
    spawnRunner,
    buildDockerSpawn(["info", "--format", "{{.OperatingSystem}}"], { env }),
  )
  const docker = validateDockerDesktopProbe({ contextHost, operatingSystem: os.stdout.trim(), env })
  const version = await runRequired(
    spawnRunner,
    buildSupabaseSpawn(["--version"], { repoRoot, env }),
  )
  const supabase = version.stdout.trim()
  if (supabase !== "2.109.1") {
    throw new Error(`Supabase CLI version must be 2.109.1, received ${supabase}`)
  }
  return { docker, supabase }
}

export async function ensureDockerDesktop({
  env,
  spawnRunner,
  existingDockerOwnership,
  findDockerApp = findDockerAppPath,
}) {
  const info = await spawnRunner(buildDockerSpawn(["info"], { env }))
  if (info.exitCode === 0) {
    await runDoctor({ env, spawnRunner })
    return { ownership: "preexisting", proof: null }
  }
  const appPath = findDockerApp(env)
  if (appPath) {
    const ownership =
      existingDockerOwnership === "task-installed" ? "task-installed" : "task-started"
    await runRequired(spawnRunner, {
      command: "open",
      args: ["-a", "Docker"],
      options: { shell: false, env: createDockerEnv(env) },
      timeoutMs: 15_000,
    })
    await waitForDockerDesktop({ env, spawnRunner })
    const daemonIdentity = await captureDockerDaemonIdentity({ env, spawnRunner })
    return {
      ownership,
      proof: { initialDockerInfoExitCode: info.exitCode, action: "open -a Docker", daemonIdentity },
    }
  }
  return { ownership: "needs-install", proof: { initialDockerInfoExitCode: info.exitCode } }
}

export async function installDockerDesktop({ env, spawnRunner }) {
  await runRequired(spawnRunner, {
    command: "brew",
    args: ["install", "--cask", "docker"],
    options: { shell: false, env: createDockerEnv(env) },
    timeoutMs: 180_000,
  })
  await runRequired(spawnRunner, {
    command: "open",
    args: ["-a", "Docker"],
    options: { shell: false, env: createDockerEnv(env) },
    timeoutMs: 15_000,
  })
  await waitForDockerDesktop({ env, spawnRunner })
  return {
    initialDockerInfoExitCode: 1,
    action: "brew install --cask docker",
    daemonIdentity: await captureDockerDaemonIdentity({ env, spawnRunner }),
  }
}

export async function captureDockerDaemonIdentity({ env, spawnRunner }) {
  for (const processName of ["com.docker.backend", "Docker"]) {
    const found = await spawnRunner({
      command: "pgrep",
      args: processName === "Docker" ? ["-x", processName] : ["-f", processName],
      options: { shell: false, env: createDockerEnv(env) },
      timeoutMs: 15_000,
    })
    const pid = found.stdout
      .split(/\s+/)
      .map(Number)
      .find((value) => Number.isInteger(value) && value > 0)
    if (!pid) continue
    const ps = await runRequired(spawnRunner, {
      command: "ps",
      args: ["-p", String(pid), "-o", "lstart=", "-o", "comm="],
      options: { shell: false, env: createDockerEnv(env) },
      timeoutMs: 15_000,
    })
    const startIdentity = ps.stdout.trim()
    if (!startIdentity) throw new Error("Docker daemon identity start time is empty")
    return { processName, pid, startIdentity }
  }
  throw new Error("Unable to establish Docker daemon identity")
}

export async function assertDockerDaemonIdentity({ expectedIdentity, env, spawnRunner }) {
  if (
    !expectedIdentity ||
    typeof expectedIdentity.processName !== "string" ||
    !Number.isInteger(expectedIdentity.pid) ||
    expectedIdentity.pid <= 0 ||
    typeof expectedIdentity.startIdentity !== "string" ||
    expectedIdentity.startIdentity.length === 0
  ) {
    throw new Error("Task-owned Docker quit requires captured daemon identity")
  }
  const liveIdentity = await captureDockerDaemonIdentity({ env, spawnRunner })
  if (
    liveIdentity.processName !== expectedIdentity.processName ||
    liveIdentity.pid !== expectedIdentity.pid ||
    liveIdentity.startIdentity !== expectedIdentity.startIdentity
  ) {
    throw new Error("Live Docker daemon identity does not match current-run ownership proof")
  }
  return liveIdentity
}

export async function waitForDockerDesktop({ env, spawnRunner, timeoutMs = 180_000 }) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await runDoctor({ env, spawnRunner })
      return
    } catch {
      await delay(1_000)
    }
  }
  throw new Error("Timed out waiting for Docker Desktop")
}

export async function waitForDockerUnavailable({ env, spawnRunner, timeoutMs }) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await spawnRunner(buildDockerSpawn(["info"], { env }))
    if (result.exitCode !== 0) {
      return
    }
    await delay(1_000)
  }
  throw new Error("Timed out waiting for task-owned Docker to quit")
}

export async function scanProjectResources() {
  const [containers, volumes, networks] = await Promise.all([
    scanDockerNames("ps", ["-a", "--format", "{{.Names}}", "--filter", `label=${PROJECT_LABEL}`]),
    scanDockerNames("volume", [
      "ls",
      "--format",
      "{{.Name}}",
      "--filter",
      `label=${PROJECT_LABEL}`,
    ]),
    scanDockerNames("network", [
      "ls",
      "--format",
      "{{.Name}}",
      "--filter",
      `label=${PROJECT_LABEL}`,
    ]),
  ])
  const [namedContainers, namedVolumes, namedNetworks] = await Promise.all([
    scanDockerNames("ps", ["-a", "--format", "{{.Names}}"]),
    scanDockerNames("volume", ["ls", "--format", "{{.Name}}"]),
    scanDockerNames("network", ["ls", "--format", "{{.Name}}"]),
  ])
  return {
    containers: uniqueStrings([
      ...containers,
      ...namedContainers.filter((name) => PROJECT_RESOURCE_PATTERN.test(name)),
    ]),
    volumes: uniqueStrings([
      ...volumes,
      ...namedVolumes.filter((name) => PROJECT_RESOURCE_PATTERN.test(name)),
    ]),
    networks: uniqueStrings([
      ...networks,
      ...namedNetworks.filter((name) => PROJECT_RESOURCE_PATTERN.test(name)),
    ]),
  }
}

export function assertZeroResources(resources) {
  for (const key of ["containers", "volumes", "networks"]) {
    if (!Array.isArray(resources[key]) || resources[key].length !== 0) {
      throw new Error(`Supabase ${key} still exist for project ${PROJECT_ID}`)
    }
  }
}

async function scanDockerNames(command, args) {
  const result = await runSpawn(buildDockerSpawn([command, ...args]))
  if (result.exitCode !== 0) {
    throw new Error(`Docker ${command} scan failed`)
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
