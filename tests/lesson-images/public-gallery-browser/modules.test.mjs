import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { attachBrowserTelemetry, createRuntimeReceipt } from "./browser-telemetry.mjs"
import { buildPublishedArtifactNames, createRunConfig } from "./config.mjs"

test("builds the complete public gallery artifact contract without duplicate publications", () => {
  const names = buildPublishedArtifactNames()

  assert.equal(names.length, 26)
  assert.equal(new Set(names).size, names.length)
  for (const state of ["zero", "one", "five", "broken"]) {
    for (const viewport of ["desktop", "tablet", "mobile", "narrow"]) {
      assert.ok(names.includes(`public-gallery-${state}-${viewport}.png`))
    }
  }
  assert.ok(names.includes("public-gallery-selected-image-3.png"))
  assert.ok(names.includes("public-gallery-trace.zip"))
})

test("bounds injected timeouts while preserving an explicit evidence directory", () => {
  const config = createRunConfig({
    PUBLIC_GALLERY_CLEANUP_TIMEOUT_MS: "1000",
    PUBLIC_GALLERY_EVIDENCE_DIR: ".omo/evidence/gallery-contract",
    PUBLIC_GALLERY_RUN_TIMEOUT_MS: "999999",
  })

  assert.equal(config.cleanupTimeoutMs, 1_000)
  assert.equal(config.runTimeoutMs, 110_000)
  assert.match(config.evidenceDir, /\.omo\/evidence\/gallery-contract$/u)
  assert.match(config.stagingDir, /\.staging-[0-9a-f-]+$/u)
  assert.match(config.runIdHash, /^[0-9a-f]{16}$/u)
})

test("classifies browser telemetry and redacts fixture identifiers from observed paths", () => {
  const page = new EventEmitter()
  const runtime = createRuntimeReceipt()
  attachBrowserTelemetry(page, runtime)
  const fixtureId = "11111111-1111-4111-8111-111111111111"

  page.emit("console", { text: () => "Failed to load resource: 404", type: () => "error" })
  page.emit("console", { text: () => "render exploded", type: () => "error" })
  page.emit("pageerror", new Error("page exploded"))
  page.emit("requestfailed", request("net::ERR_ABORTED", `/lessons/${fixtureId}`))
  page.emit(
    "requestfailed",
    request("net::ERR_BLOCKED_BY_ORB", `/storage/v1/object/public/lesson-images/${fixtureId}/x`),
  )
  page.emit("requestfailed", request("net::ERR_FAILED", "/unexpected"))
  page.emit("response", response(200, `/lessons/${fixtureId}`))

  assert.deepEqual(runtime.expectedNetworkConsoleErrors, ["Failed to load resource: 404"])
  assert.deepEqual(runtime.consoleErrors, ["render exploded"])
  assert.deepEqual(runtime.pageErrors, ["page exploded"])
  assert.equal(runtime.abortedRequests[0].path, "/lessons/<id>")
  assert.equal(runtime.expectedFailedRequests.length, 1)
  assert.equal(runtime.failedRequests.length, 1)
  assert.deepEqual(runtime.responses, [{ method: "GET", path: "/lessons/<id>", status: 200 }])
})

function request(failure, pathname) {
  return {
    failure: () => ({ errorText: failure }),
    method: () => "GET",
    url: () => `http://127.0.0.1:3268${pathname}`,
  }
}

function response(status, pathname) {
  return {
    request: () => ({ method: () => "GET" }),
    status: () => status,
    url: () => `http://127.0.0.1:3268${pathname}`,
  }
}
