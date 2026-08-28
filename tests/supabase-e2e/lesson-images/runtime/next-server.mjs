import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { selectPort } from "./network.mjs"
import { waitForNextReady } from "./next-readiness.mjs"
import { stopOwnedChild } from "./process-ownership.mjs"
import { buildProductionWorkspace } from "./production-build.mjs"
import { writeRuntimeReceipt } from "./receipt.mjs"
import { copyWorkspace, pickEnvironment, removeOwnedTemp } from "./workspace.mjs"

const defaults = {
  buildWorkspace: buildProductionWorkspace,
  copyWorkspace,
  makeTempRoot: () => mkdtemp(path.join(os.tmpdir(), "spolink-task9-next-")),
  pickEnvironment,
  removeOwnedTemp,
  selectPort,
  spawn,
  stopOwnedChild,
  symlink,
  waitForNextReady,
  writeReceipt: writeRuntimeReceipt,
}

export const startIsolatedLessonImageNext = createIsolatedLessonImageNext()

export function createIsolatedLessonImageNext(overrides = {}) {
  const dependencies = { ...defaults, ...overrides }
  return async function start({ portBase = 3400, repoRoot, runId = "focused", status }) {
    const tempRoot = await dependencies.makeTempRoot()
    let build = null
    let child = null
    let phase = "copy-workspace"
    let port = null
    let readiness = null
    const output = { stderr: "", stdout: "" }

    try {
      await dependencies.copyWorkspace(repoRoot, tempRoot)
      phase = "link-dependencies"
      await dependencies.symlink(
        path.join(repoRoot, "node_modules"),
        path.join(tempRoot, "node_modules"),
        "dir",
      )
      phase = "port-selection"
      port = await dependencies.selectPort(portBase)
      phase = "production-build"
      const env = dependencies.pickEnvironment(["HOME", "PATH", "TMPDIR"])
      env.NEXT_PUBLIC_SUPABASE_URL = status.apiUrl
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.anonKey
      env.NEXT_TELEMETRY_DISABLED = "1"
      env.NODE_ENV = "production"
      env.SUPABASE_SERVICE_ROLE_KEY = status.serviceRoleKey
      await dependencies.writeReceipt(runId, {
        status: "building",
        tempRootSha256: sha256(tempRoot),
      })
      build = await dependencies.buildWorkspace({ env, repoRoot, tempRoot })
      await dependencies.writeReceipt(runId, {
        buildStderrSha256: build.stderrSha256,
        buildStdoutSha256: build.stdoutSha256,
        status: "built",
        tempRootSha256: sha256(tempRoot),
      })
      child = dependencies.spawn(
        process.execPath,
        [
          path.join(repoRoot, "node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { cwd: tempRoot, detached: true, env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      )
      child.stdout.on("data", (chunk) => {
        output.stdout += chunk
      })
      child.stderr.on("data", (chunk) => {
        output.stderr += chunk
      })
      phase = "semantic-readiness"
      const server = { baseUrl: `http://127.0.0.1:${port}`, ownedPid: child.pid, port, tempRoot }
      await dependencies.writeReceipt(runId, {
        nextPid: child.pid,
        nextPort: port,
        runtime: "production",
        status: "starting",
        tempRootSha256: sha256(tempRoot),
      })
      readiness = await dependencies.waitForNextReady(server.baseUrl, child, output, {
        port,
        tempRoot,
      })
      await dependencies.writeReceipt(runId, {
        nextPid: child.pid,
        nextPort: port,
        runtime: "production",
        status: "ready",
        tempRootSha256: sha256(tempRoot),
      })
      return {
        ...server,
        async stop() {
          const result = await dependencies.stopOwnedChild(child, port)
          await dependencies.removeOwnedTemp(tempRoot)
          await dependencies.writeReceipt(runId, {
            cleanup: { descendants: 0, ports: 0, tempRoots: 0 },
            nextPidSha256: sha256(String(child.pid)),
            nextPort: port,
            productionBuild: buildReceipt(build),
            readiness: readinessReceipt(readiness),
            runtime: "production",
            status: "stopped",
            stopSignal: result.signal,
            tempRemoved: true,
          })
          return result
        },
      }
    } catch (error) {
      const result =
        child && port ? await dependencies.stopOwnedChild(child, port).catch(() => null) : null
      await dependencies.removeOwnedTemp(tempRoot).catch(() => {})
      await dependencies
        .writeReceipt(runId, {
          childDiagnostics: receiptDiagnostics(error),
          failurePhase: phase,
          nextPort: port,
          status: "start-failed-cleaned",
          stopSignal: result?.signal ?? "none",
          tempRemoved: true,
        })
        .catch(() => {})
      throw error
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function receiptDiagnostics(error) {
  const diagnostics = error?.childDiagnostics
  return {
    errorSha256: sha256(error instanceof Error ? error.message : String(error)),
    exitCode: diagnostics?.exitCode ?? null,
    lastCacheControl: diagnostics?.lastCacheControl ?? null,
    lastCode: diagnostics?.lastCode ?? null,
    lastContentType: diagnostics?.lastContentType ?? null,
    lastProbeKind: diagnostics?.lastProbeKind ?? null,
    lastStatus: diagnostics?.lastStatus ?? null,
    signal: diagnostics?.signal ?? null,
    stderrSha256: diagnostics?.stderrSha256 ?? null,
    stdoutSha256: diagnostics?.stdoutSha256 ?? null,
  }
}

function buildReceipt(build) {
  return {
    stderrSha256: build?.stderrSha256 ?? null,
    stdoutSha256: build?.stdoutSha256 ?? null,
  }
}

function readinessReceipt(readiness) {
  return {
    bodySha256: readiness?.bodySha256 ?? null,
    cacheControl: readiness?.cacheControl ?? null,
    code: readiness?.code ?? null,
    contentType: readiness?.contentType ?? null,
    probeKind: readiness?.kind ?? null,
    status: readiness?.status ?? null,
  }
}
