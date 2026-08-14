import { readFile } from "node:fs/promises"
import path from "node:path"

export const repoRoot = path.resolve(new URL("..", import.meta.url).pathname, "..")
export const baseEnv = {
  HOME: "/Users/tester",
  PATH: "/usr/bin:/bin",
  TMPDIR: "/tmp",
}

export function localStatusJson() {
  return JSON.stringify({
    API_URL: "http://127.0.0.1:54321",
    DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
    SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
  })
}

export async function copyConfigInto(dir) {
  const { mkdir, writeFile } = await import("node:fs/promises")
  await mkdir(path.join(dir, "supabase"), { recursive: true })
  await writeFile(
    path.join(dir, "supabase", "config.toml"),
    await readFile(path.join(repoRoot, "supabase", "config.toml"), "utf8"),
  )
}

export function desktopSpawnRunner(calls = [], overrides = {}) {
  return async (spec) => {
    calls.push(spec)
    if (overrides[spec.command]) {
      const result = await overrides[spec.command](spec)
      if (result) return result
    }
    if (spec.command === "docker" && spec.args[0] === "context") {
      return { exitCode: 0, stdout: '"unix:///Users/tester/.docker/run/docker.sock"', stderr: "" }
    }
    if (spec.command === "docker" && spec.args[0] === "info") {
      return { exitCode: 0, stdout: "Docker Desktop", stderr: "" }
    }
    if (spec.command === "corepack" && spec.args.at(-1) === "--version") {
      return { exitCode: 0, stdout: "2.109.1", stderr: "" }
    }
    if (spec.command === "corepack" && spec.args.includes("status")) {
      return { exitCode: 0, stdout: localStatusJson(), stderr: "" }
    }
    if (spec.command === "pgrep") {
      return { exitCode: 0, stdout: "4242\n", stderr: "" }
    }
    if (spec.command === "ps") {
      return {
        exitCode: 0,
        stdout:
          "Thu Jul 16 09:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n",
        stderr: "",
      }
    }
    return { exitCode: 0, stdout: "", stderr: "" }
  }
}

export function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

export async function waitForFile(filePath) {
  const { access } = await import("node:fs/promises")
  const startedAt = Date.now()
  while (Date.now() - startedAt < 1_000) {
    try {
      await access(filePath)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}
