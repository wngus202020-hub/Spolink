import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import test from "node:test"

import { waitForNextReady } from "./next-readiness.mjs"
import { stopOwnedChild } from "./process-ownership.mjs"

const validWebpBytes = [0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

test("cold Next startup requires static bytes and the semantic private API contract", async () => {
  const child = { exitCode: null }
  const output = { stderr: "", stdout: "" }
  let fetchCalls = 0
  let now = 0
  const requestedUrls = []

  const readiness = await waitForNextReady("http://127.0.0.1:3400", child, output, {
    delay: async () => {},
    fetch: async (url) => {
      fetchCalls += 1
      requestedUrls.push(url)
      return url.endsWith("/images/lesson-tennis.webp")
        ? staticResponse(200, validWebpBytes, "image/webp")
        : jsonResponse(401, "application/json", "private, no-store", {
            error: { code: "UNAUTHENTICATED" },
          })
    },
    now: () => (now += 25),
    timeoutMs: 100,
  })

  assert.equal(fetchCalls, 2)
  assert.deepEqual(
    {
      cacheControl: readiness.cacheControl,
      code: readiness.code,
      contentType: readiness.contentType,
      kind: readiness.kind,
      status: readiness.status,
    },
    {
      cacheControl: "private, no-store",
      code: "UNAUTHENTICATED",
      contentType: "application/json",
      kind: "private-api",
      status: 401,
    },
  )
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:3400/images/lesson-tennis.webp",
    "http://127.0.0.1:3400/api/lessons/00000000-0000-4000-8000-000000000001/images/upload-intents",
  ])
})

test("parallel Next dev static readiness does not hide a private API 500", async () => {
  const child = new EventEmitter()
  child.exitCode = null
  const output = { stderr: "dynamic route compilation failed", stdout: "Ready in 100ms" }
  const requestedUrls = []

  await assert.rejects(
    waitForNextReady("http://127.0.0.1:3400", child, output, {
      delay: async () => {
        child.exitCode = 1
        child.emit("close", 1, null)
      },
      fetch: async (url) => {
        requestedUrls.push(url)
        if (url.endsWith("/images/lesson-tennis.webp")) {
          return staticResponse(200, validWebpBytes, "image/webp")
        }
        return jsonResponse(500, "text/html; charset=utf-8", "no-cache, must-revalidate", {
          error: "dev compiler failed",
        })
      },
      now: () => 0,
      timeoutMs: 100,
    }),
    /"lastStatus":500/u,
  )

  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:3400/images/lesson-tennis.webp",
    "http://127.0.0.1:3400/api/lessons/00000000-0000-4000-8000-000000000001/images/upload-intents",
  ])
})

test("ready Next reject then 500 then close reports the last probe without waiting for timeout", async () => {
  const child = new EventEmitter()
  child.exitCode = null
  const output = { stderr: "route failed secret-value", stdout: "Ready in 100ms" }
  let delayCalls = 0
  let fetchCalls = 0

  await assert.rejects(
    waitForNextReady("http://127.0.0.1:3400", child, output, {
      delay: async () => {
        delayCalls += 1
        if (delayCalls === 2) {
          child.exitCode = 1
          child.emit("close", 1, null)
        }
      },
      fetch: async () => {
        fetchCalls += 1
        if (fetchCalls === 1) throw new Error("connection rejected")
        return staticResponse(500, [0x65, 0x72, 0x72], "text/html")
      },
      now: () => 0,
      timeoutMs: 100,
    }),
    (error) => {
      assert.match(error.message, /"event":"close"/u)
      assert.match(error.message, /"lastStatus":500/u)
      assert.match(error.message, /"lastContentType":"text\/html"/u)
      assert.match(error.message, /"stderrSha256":"[a-f0-9]{64}"/u)
      assert.doesNotMatch(error.message, /secret-value/u)
      return true
    },
  )
  assert.equal(fetchCalls, 2)
})

test("already-signaled owned child waits for close without sending another signal", async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.killed = true
  child.signalCode = "SIGTERM"
  child.signals = []
  child.kill = (signal) => child.signals.push(signal)
  queueMicrotask(() => child.emit("close", null, "SIGTERM"))

  const result = await stopOwnedChild(child, 3458, { waitForPortFree: async () => {} })

  assert.deepEqual(child.signals, [])
  assert.deepEqual(result, { exitCode: 0, signal: "SIGTERM" })
})

test("owned process-group cleanup terminates a real descendant", async () => {
  const parent = spawn(
    process.execPath,
    [
      "-e",
      'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(child.pid); setInterval(() => {}, 1000)',
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  )
  const descendantPid = Number(await readOutputLine(parent.stdout))

  await stopOwnedChild(parent, 3459, {
    delay: () => new Promise((resolve) => setTimeout(resolve, 20)),
    waitForPortFree: async () => {},
  })

  await waitForProcessGone(descendantPid)
})

function staticResponse(status, bytes, contentType) {
  return {
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    status,
  }
}

function jsonResponse(status, contentType, cacheControl, body) {
  const bytes = Buffer.from(JSON.stringify(body))
  return {
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    headers: {
      get(name) {
        if (name.toLowerCase() === "cache-control") return cacheControl
        if (name.toLowerCase() === "content-type") return contentType
        return null
      },
    },
    status,
  }
}

function readOutputLine(stream) {
  return new Promise((resolve) => {
    stream.once("data", (chunk) => resolve(chunk.toString("utf8").trim()))
  })
}

async function waitForProcessGone(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error?.code === "ESRCH") return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail("owned descendant remained alive")
}
