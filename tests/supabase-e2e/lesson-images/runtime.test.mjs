import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import http from "node:http"
import test from "node:test"
import { requestJson } from "./http-client.mjs"
import { captureSplitLessonImageSourceBinding } from "./live/source-binding.mjs"
import { waitForNextReady } from "./runtime/next-readiness.mjs"
import { createIsolatedLessonImageNext } from "./runtime/next-server.mjs"
import { stopOwnedChild } from "./runtime/process-ownership.mjs"
import { startLessonImageFaultProxy } from "./runtime.mjs"

test("live evidence source binding includes every split live and runtime module", async () => {
  const binding = await captureSplitLessonImageSourceBinding()
  const paths = new Set(binding.files.map((entry) => entry.path))

  assert.ok(paths.has("tests/supabase-e2e/lesson-images/live/context.mjs"))
  assert.ok(paths.has("tests/supabase-e2e/lesson-images/runtime/next-server.mjs"))
  assert.equal(binding.scopedFileCount, binding.files.length - binding.productionFileCount)
})

test("cold Next startup times out at its injected readiness deadline", async () => {
  const child = { exitCode: null }
  let now = 0

  await assert.rejects(
    waitForNextReady(
      "http://127.0.0.1:3400",
      child,
      { stderr: "cold" },
      {
        delay: async () => {},
        fetch: async () => {
          throw new Error("not ready")
        },
        now: () => (now += 50),
        timeoutMs: 100,
      },
    ),
    /"event":"timeout"/u,
  )
})

test("failed Next startup removes its owned temp and records a cleanup receipt", async () => {
  const receipts = []
  const removed = []
  const start = createIsolatedLessonImageNext({
    copyWorkspace: async () => {
      throw new Error("copy failed")
    },
    makeTempRoot: async () => "/tmp/spolink-task9-next-test",
    removeOwnedTemp: async (value) => removed.push(value),
    writeReceipt: async (runId, value) => receipts.push({ runId, value }),
  })

  await assert.rejects(
    start({
      repoRoot: "/repo",
      status: { anonKey: "anon", apiUrl: "http://local", serviceRoleKey: "service" },
    }),
    /copy failed/u,
  )
  assert.deepEqual(removed, ["/tmp/spolink-task9-next-test"])
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].runId, "focused")
  assert.equal(receipts[0].value.failurePhase, "copy-workspace")
  assert.match(receipts[0].value.childDiagnostics.errorSha256, /^[a-f0-9]{64}$/u)
  assert.equal(receipts[0].value.nextPort, null)
  assert.equal(receipts[0].value.status, "start-failed-cleaned")
  assert.equal(receipts[0].value.stopSignal, "none")
  assert.equal(receipts[0].value.tempRemoved, true)
})

test("isolated Next builds once and starts the production runtime", async () => {
  const buildCalls = []
  const removed = []
  const receipts = []
  const spawns = []
  const child = new EventEmitter()
  child.exitCode = null
  child.pid = 43210
  child.stderr = new EventEmitter()
  child.stdout = new EventEmitter()
  const start = createIsolatedLessonImageNext({
    buildWorkspace: async (input) => {
      buildCalls.push(input)
      return { stderrSha256: "a".repeat(64), stdoutSha256: "b".repeat(64) }
    },
    copyWorkspace: async () => {},
    makeTempRoot: async () => "/tmp/spolink-task9-next-production-test",
    pickEnvironment: () => ({ HOME: "/home", PATH: "/bin", TMPDIR: "/tmp" }),
    removeOwnedTemp: async (value) => removed.push(value),
    selectPort: async () => 3456,
    spawn: (...args) => {
      spawns.push(args)
      return child
    },
    stopOwnedChild: async () => ({ exitCode: 0, signal: "SIGTERM" }),
    symlink: async () => {},
    waitForNextReady: async () => {},
    writeReceipt: async (runId, value) => receipts.push({ runId, value }),
  })

  const server = await start({
    repoRoot: "/repo",
    runId: "production-test",
    status: { anonKey: "anon", apiUrl: "http://local", serviceRoleKey: "service" },
  })
  await server.stop()

  assert.equal(buildCalls.length, 1)
  assert.equal(buildCalls[0].tempRoot, "/tmp/spolink-task9-next-production-test")
  assert.deepEqual(spawns[0][1], [
    "/repo/node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3456",
  ])
  assert.equal(spawns[0][2].env.NODE_ENV, "production")
  assert.equal(
    receipts.find((entry) => entry.value.status === "ready")?.value.runtime,
    "production",
  )
  assert.deepEqual(removed, ["/tmp/spolink-task9-next-production-test"])
})

test("owned child escalates from SIGTERM to SIGKILL and waits for its exact port", async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signals = []
  child.kill = (signal) => {
    child.signals.push(signal)
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null, "SIGKILL"))
    return true
  }
  const waitedPorts = []

  const result = await stopOwnedChild(child, 3456, {
    delay: async () => {},
    waitForPortFree: async (port) => waitedPorts.push(port),
  })

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"])
  assert.deepEqual(waitedPorts, [3456])
  assert.deepEqual(result, { exitCode: 0, signal: "SIGKILL" })
})

test("owned child force-kills a real subprocess that ignores SIGTERM", async () => {
  const child = spawn(
    process.execPath,
    ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  await waitForOutput(child.stdout, "ready")

  const result = await stopOwnedChild(child, 3457, {
    delay: () => new Promise((resolve) => setTimeout(resolve, 20)),
    waitForPortFree: async () => {},
  })

  assert.equal(result.signal, "SIGKILL")
})

test("fault proxy forwards requests and consumes exactly one requested provider failure", async () => {
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ method: request.method, ok: true }))
  })
  await listen(upstream)
  const address = upstream.address()
  assert.ok(address && typeof address !== "string")
  const proxy = await startLessonImageFaultProxy(`http://127.0.0.1:${address.port}`)
  try {
    const forwarded = await fetch(`${proxy.baseUrl}/rest/v1/rpc/other`, { method: "POST" })
    assert.equal(forwarded.status, 200)
    assert.deepEqual(await forwarded.json(), { method: "POST", ok: true })

    proxy.failNext("finalize_delete_rpc")
    const failed = await fetch(`${proxy.baseUrl}/rest/v1/rpc/finalize_delete_lesson_image`, {
      method: "POST",
    })
    assert.equal(failed.status, 503)
    assert.equal(proxy.pendingFaults(), 0)
    assert.equal(proxy.observations.length, 1)

    const retried = await fetch(`${proxy.baseUrl}/rest/v1/rpc/finalize_delete_lesson_image`, {
      method: "POST",
    })
    assert.equal(retried.status, 200)
  } finally {
    await proxy.stop()
    await close(upstream)
  }
})

test("same-origin anonymous mutation reaches auth mapping and returns 401", async () => {
  const server = http.createServer((request, response) => {
    const expectedOrigin = `http://${request.headers.host}`
    const sameOrigin = request.headers.origin === expectedOrigin
    response.writeHead(sameOrigin ? 401 : 403, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: { code: sameOrigin ? "UNAUTHORIZED" : "FORBIDDEN" } }))
  })
  await listen(server)
  const address = server.address()
  assert.ok(address && typeof address !== "string")

  try {
    const result = await requestJson(`http://127.0.0.1:${address.port}`, "/anonymous")
    assert.equal(result.status, 401)
    assert.equal(result.code, "UNAUTHORIZED")
  } finally {
    await close(server)
  }
})

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function waitForOutput(stream, expected) {
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      if (chunk.toString().includes(expected)) resolve()
    })
    stream.once("error", reject)
  })
}
