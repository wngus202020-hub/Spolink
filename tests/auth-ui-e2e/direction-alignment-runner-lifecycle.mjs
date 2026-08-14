import { spawn } from "node:child_process"
import { chmod, cp, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { isLoopbackPortFree, reserveLoopbackPort } from "./ports.mjs"
import { buildChildEnv, runBuffered, sha256, stopChild } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

export class DirectionAlignmentLifecycle {
  constructor(repoRoot) {
    this.repoRoot = repoRoot
    this.buildRoot = null
    this.nextChild = null
    this.ownedPort = null
    this.rawOutput = null
    this.reservation = null
  }

  async prepareRawOutput() {
    this.rawOutput = await prepareRawPlaywrightOutputDir({
      prefix: "spolink-direction-playwright-",
      retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
      suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
    })
    return this.rawOutput.dir
  }

  async buildAndStart() {
    this.buildRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-direction-build-"))
    await mkdir(path.join(this.buildRoot, "workspace"), { mode: 0o700 })
    const checkout = path.join(this.buildRoot, "workspace")
    await this.copyWorkspace(checkout)
    await symlink(
      path.join(this.repoRoot, "node_modules"),
      path.join(checkout, "node_modules"),
      "dir",
    )
    const build = await runBuffered("corepack", ["pnpm", "exec", "next", "build", "--webpack"], {
      cwd: checkout,
      env: buildChildEnv(process.env, { NODE_ENV: "production" }),
    })
    if (build.exitCode !== 0) throw new Error(`production build failed (${build.exitCode})`)

    this.reservation = await reserveLoopbackPort()
    const { baseUrl, port } = this.reservation
    this.ownedPort = port
    await this.reservation.release()
    this.reservation = null
    this.nextChild = spawn(
      "corepack",
      ["pnpm", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: checkout,
        env: buildChildEnv(process.env, { NODE_ENV: "production" }),
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
      },
    )
    await this.waitForReady(baseUrl)
    return baseUrl
  }

  async copyWorkspace(checkout) {
    const skipped = new Set([".codegraph", ".git", ".next", ".omo", "node_modules"])
    await cp(this.repoRoot, checkout, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(this.repoRoot, source)
        const isSupabaseRuntime =
          relative === "supabase/.branches" ||
          relative.startsWith(`supabase/.branches${path.sep}`) ||
          relative === "supabase/.temp" ||
          relative.startsWith(`supabase/.temp${path.sep}`)
        return (relative === "" || !skipped.has(relative.split(path.sep)[0])) && !isSupabaseRuntime
      },
    })
  }

  async waitForReady(baseUrl) {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (this.nextChild?.exitCode !== null) throw new Error("owned production server exited early")
      try {
        const response = await fetch(baseUrl)
        if (response.ok) return
      } catch {
        // The owned server is still within its bounded startup window.
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error("owned production server readiness timed out")
  }

  async chmodRawRoot() {
    if (this.rawOutput) await chmod(this.rawOutput.dir, 0o700)
  }

  async cleanupOwned() {
    const errors = []
    const buildPath = this.buildRoot
    const rawPath = this.rawOutput?.dir ?? null
    const retained = this.rawOutput?.retained ?? false
    if (this.nextChild) {
      try {
        await stopChild(this.nextChild, this.ownedPort)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      this.nextChild = null
    }
    try {
      if (this.reservation) await this.reservation.release()
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    this.reservation = null
    try {
      if (this.rawOutput) await this.rawOutput.cleanup()
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    try {
      if (this.buildRoot) await rm(this.buildRoot, { force: true, recursive: true })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    const buildRootRemoved = buildPath ? !(await pathExists(buildPath)) : true
    const rawOutputRemoved = rawPath ? !(await pathExists(rawPath)) : true
    const ownedPortReleased = this.ownedPort ? await isLoopbackPortFree(this.ownedPort) : true
    const cleanupApproved =
      errors.length === 0 && buildRootRemoved && ownedPortReleased && (retained || rawOutputRemoved)
    const proofSha256 = sha256(
      JSON.stringify({ buildRootRemoved, errors, ownedPortReleased, rawOutputRemoved, retained }),
    )
    return {
      buildRootRemoved,
      exitCode: cleanupApproved ? 0 : 1,
      ownedPortReleased,
      proofSha256,
      rawOutputRemoved,
      rawOutputRetained: retained,
    }
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

export async function capturePort3000() {
  const result = await runBuffered("lsof", ["-nP", "-iTCP:3000", "-sTCP:LISTEN", "-t"], {
    timeoutMs: 10_000,
  })
  return result.stdout.trim() || "none"
}
