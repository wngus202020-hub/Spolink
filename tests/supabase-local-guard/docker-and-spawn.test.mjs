import assert from "node:assert/strict"
import process from "node:process"
import test from "node:test"

import {
  assertDirectTrigger,
  buildSupabaseSpawn,
  createDockerEnv,
  createSupabaseSealedEnv,
  parseDockerContextHost,
  runDoctor,
  runSpawn,
  validateDockerDesktopProbe,
} from "../../scripts/supabase-local.mjs"
import { baseEnv, repoRoot } from "./helpers.mjs"

test("builds exact sealed Corepack Supabase spawns and rejects shell or direct pnpm", () => {
  const spec = buildSupabaseSpawn(["status", "-o", "json"], { repoRoot, env: baseEnv })
  assert.equal(spec.command, "corepack")
  assert.deepEqual(spec.args, ["pnpm", "exec", "supabase", "status", "-o", "json"])
  assert.equal(spec.options.cwd, repoRoot)
  assert.equal(spec.options.shell, false)
  assert.deepEqual(Object.keys(spec.options.env).sort(), [
    "HOME",
    "PATH",
    "SUPABASE_TELEMETRY_DISABLED",
    "TMPDIR",
  ])
  assert.deepEqual(
    buildSupabaseSpawn(["stop", "--no-backup", "--project-id", "spolink"], {
      repoRoot,
      env: baseEnv,
    }).args,
    ["pnpm", "exec", "supabase", "stop", "--no-backup", "--project-id", "spolink"],
  )
  assert.deepEqual(
    buildSupabaseSpawn(["test", "db", "supabase/tests", "--local"], { repoRoot, env: baseEnv })
      .args,
    ["pnpm", "exec", "supabase", "test", "db", "supabase/tests", "--local"],
  )
})

test("seals docker and supabase child environments and rejects inherited controls", () => {
  assert.deepEqual(Object.keys(createDockerEnv(baseEnv)).sort(), ["HOME", "PATH", "TMPDIR"])
  assert.deepEqual(Object.keys(createSupabaseSealedEnv(baseEnv)).sort(), [
    "HOME",
    "PATH",
    "SUPABASE_TELEMETRY_DISABLED",
    "TMPDIR",
  ])
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "SUPABASE_ACCESS_TOKEN"]) {
    assert.throws(() => createSupabaseSealedEnv({ ...baseEnv, [key]: "unsafe" }), new RegExp(key))
    assert.throws(() => createDockerEnv({ ...baseEnv, [key]: "unsafe" }), new RegExp(key))
  }
})

test("parses Docker context JSON and accepts only local Docker Desktop endpoints", () => {
  assert.equal(
    parseDockerContextHost('"unix:///Users/tester/.docker/run/docker.sock"', baseEnv),
    "unix:///Users/tester/.docker/run/docker.sock",
  )
  assert.equal(
    parseDockerContextHost('"unix:///var/run/docker.sock"', baseEnv),
    "unix:///var/run/docker.sock",
  )
  assert.throws(
    () => parseDockerContextHost('"tcp://remote:2375"', baseEnv),
    /approved local Docker context/,
  )
  assert.throws(
    () => parseDockerContextHost("unix://$HOME/.docker/run/docker.sock", baseEnv),
    /JSON/,
  )
  assert.equal(
    validateDockerDesktopProbe({
      contextHost: "unix:///Users/tester/.docker/run/docker.sock",
      operatingSystem: "Docker Desktop 4.44.0",
      env: baseEnv,
    }),
    "Docker Desktop 4.44.0",
  )
})

test("doctor uses sealed Docker and Supabase probes", async () => {
  const calls = []
  const result = await runDoctor({
    repoRoot,
    env: baseEnv,
    spawnRunner: async (spec) => {
      calls.push(spec)
      if (spec.command === "docker" && spec.args.includes("context"))
        return { exitCode: 0, stdout: '"unix:///Users/tester/.docker/run/docker.sock"', stderr: "" }
      if (spec.command === "docker" && spec.args.includes("info"))
        return { exitCode: 0, stdout: "Docker Desktop 4.44.0", stderr: "" }
      if (spec.command === "corepack") return { exitCode: 0, stdout: "2.109.1", stderr: "" }
      return { exitCode: 0, stdout: "", stderr: "" }
    },
  })
  assert.deepEqual(result, { docker: "Docker Desktop 4.44.0", supabase: "2.109.1" })
  assert.equal(
    calls.every((call) => call.options.shell === false),
    true,
  )
  assert.equal(
    calls.some((call) => call.command === "pnpm"),
    false,
  )
})

test("direct trigger, bounded timeout, and process-group descendant kill", async () => {
  assert.equal(
    assertDirectTrigger("$omo:start-work .omo/plans/supabase-auth-rls-e2e.md"),
    "$omo:start-work .omo/plans/supabase-auth-rls-e2e.md",
  )
  assert.throws(() => assertDirectTrigger("automatic continuation"), /direct.*start-work/i)
  let descendantPid
  try {
    const descendant = `process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)`
    const script = `const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore","pipe","ignore"]});child.stdout.once("data",()=>{process.stdout.write(String(child.pid));setInterval(()=>{},1000)})`
    const result = await runSpawn({
      command: process.execPath,
      args: ["-e", script],
      options: { shell: false, env: baseEnv },
      timeoutMs: 1_000,
    })
    assert.equal(result.exitCode, 124)
    descendantPid = Number(result.stdout)
    assert.equal(Number.isInteger(descendantPid), true)
    assert.equal(isProcessAlive(descendantPid), false)
  } finally {
    if (descendantPid && isProcessAlive(descendantPid)) process.kill(descendantPid, "SIGKILL")
  }
})

test("runSpawn success path returns without timeout cleanup", async () => {
  const result = await runSpawn({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    options: { shell: false, env: baseEnv },
    timeoutMs: 1_000,
  })

  assert.deepEqual(result, { exitCode: 0, stdout: "ok", stderr: "" })
})

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
