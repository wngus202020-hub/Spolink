import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function createFakeLifecycleRepo(prefix) {
  const repoRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)))
  const binDir = path.join(repoRoot, "bin")
  const supabaseDir = path.join(repoRoot, "supabase")
  await mkdir(binDir, { recursive: true })
  await mkdir(path.join(repoRoot, ".omo", "evidence"), { mode: 0o700, recursive: true })
  await mkdir(supabaseDir, { recursive: true })
  const originalConfig = await readFile(path.join(process.cwd(), "supabase", "config.toml"), "utf8")
  const configPath = path.join(supabaseDir, "config.toml")
  await writeFile(configPath, originalConfig, { mode: 0o600 })
  const paths = {
    externalMarkerPath: path.join(repoRoot, "fake-external-runtime.marker"),
    externalPidPath: path.join(repoRoot, "fake-external-runtime.pid"),
    lockPath: path.join(repoRoot, "fake-runtime.lock"),
    logPath: path.join(repoRoot, "fake-corepack.log"),
    pidPath: path.join(repoRoot, "fake-start.pid"),
    startPath: path.join(repoRoot, "fake-start-called"),
  }
  await writeFakeCorepack(path.join(binDir, "corepack"), paths)
  return {
    ...paths,
    binDir,
    cleanup: () => rm(repoRoot, { force: true, recursive: true }),
    configPath,
    killBlockedStart: () => killPidFile(paths.pidPath),
    originalConfig,
    repoRoot,
  }
}

export function requiredEnv() {
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
  }
}

export function spawnBuffered(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  const result = new Promise((resolve, reject) => {
    let killTimer = null
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }, options.killAfterMs ?? 10_000)
    }, options.timeoutMs ?? 30_000)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      reject(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({ exitCode: code ?? (signal === "SIGTERM" ? 143 : 1), signal, stderr, stdout })
    })
  })
  return { pid: child.pid, result }
}

export async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await readFile(filePath, "utf8")
      return
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function writeFakeCorepack(filePath, paths) {
  const script = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";

const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(paths.logPath)}, args.join(" ") + "\\n");

if (args.join(" ") === "pnpm supabase:start") {
  writeFileSync(${JSON.stringify(paths.startPath)}, "started\\n");
  if (existsSync(${JSON.stringify(paths.externalMarkerPath)})) {
    process.stderr.write("fake runtime is already owned by another run\\n");
    process.exit(1);
  }
  if (process.env.FAKE_BLOCK_START === "1") {
    writeFileSync(${JSON.stringify(paths.lockPath)}, "locked\\n");
    writeFileSync(${JSON.stringify(paths.pidPath)}, String(process.pid));
    process.once("SIGTERM", () => {
      appendFileSync(${JSON.stringify(paths.logPath)}, "fake start received SIGTERM\\n");
      rmSync(${JSON.stringify(paths.lockPath)}, { force: true });
      process.exit(143);
    });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  process.exit(0);
}

if (args.join(" ") === "pnpm supabase:reset") process.exit(0);
if (args.join(" ") === "pnpm supabase:stop") {
  if (existsSync(${JSON.stringify(paths.externalMarkerPath)})) {
    const externalPid = Number(readFileSync(${JSON.stringify(paths.externalPidPath)}, "utf8"));
    process.kill(externalPid, "SIGTERM");
    rmSync(${JSON.stringify(paths.externalMarkerPath)}, { force: true });
    process.exit(0);
  }
  if (existsSync(${JSON.stringify(paths.lockPath)})) {
    process.stderr.write("fake runtime lock still held\\n");
    process.exit(1);
  }
  process.exit(0);
}
if (args.join(" ") === "pnpm supabase:assert-stopped") {
  if (existsSync(${JSON.stringify(paths.externalMarkerPath)})) {
    process.stderr.write("fake external runtime remains active\\n");
    process.exit(1);
  }
  if (existsSync(${JSON.stringify(paths.lockPath)})) {
    process.stderr.write("fake runtime lock still held\\n");
    process.exit(1);
  }
  process.exit(0);
}
if (args.slice(0, 4).join(" ") === "pnpm exec supabase status") {
  process.stdout.write(JSON.stringify({
    API_URL: "http://127.0.0.1:54321",
    DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    PUBLISHABLE_KEY: "sb_publishable_test",
    SECRET_KEY: "sb_secret_test"
  }));
  process.exit(0);
}
if (args.slice(0, 4).join(" ") === "pnpm exec next dev") {
  const port = Number(args.at(-1));
  const server = http.createServer((request, response) => {
    if (request.url === "/api/config/supabase") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ configured: true }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  server.listen(port, "127.0.0.1");
  process.once("SIGTERM", () => {
    appendFileSync(${JSON.stringify(paths.logPath)}, "fake next received SIGTERM\\n");
    process.exit(143);
  });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (args.slice(0, 3).join(" ") === "pnpm exec playwright") {
  process.stderr.write("fake playwright invoked\\n");
  const rawOutputBlock =
    process.env.SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR &&
    existsSync(process.env.SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR + "/block-playwright");
  if (process.env.FAKE_BLOCK_PLAYWRIGHT === "1" || rawOutputBlock) {
    process.once("SIGTERM", () => {
      appendFileSync(${JSON.stringify(paths.logPath)}, "fake playwright received SIGTERM\\n");
      process.exit(143);
    });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  process.exit(0);
}
if (args.join(" ") === "pnpm test:api") process.exit(0);
process.stderr.write("unexpected fake corepack command: " + args.join(" ") + "\\n");
process.exit(1);
`
  await writeFile(filePath, script, { mode: 0o700 })
  await chmod(filePath, 0o700)
}

async function killPidFile(pidPath) {
  try {
    const pid = Number(await readFile(pidPath, "utf8"))
    if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGTERM")
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ESRCH") throw error
  }
}
