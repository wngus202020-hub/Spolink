import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

export async function verifyRun(runDir) {
  const { authoring, authoringCleanup, gallery } = await readRunArtifacts(runDir)
  assert.equal(authoring.createDraftCount, 1)
  assert.equal(authoring.imageCountAfterRetry, 5)
  assert.equal(authoring.readOnlyVerified, true)
  assert.equal(authoring.staleConflictGuidanceVerified, true)
  assert.equal(authoring.submitDuringActiveIntentStatus, 409)
  assert.equal(authoring.viewportReceipts.length >= 21, true)
  assert.deepEqual(authoring.runtime.consoleErrors, [])
  assert.deepEqual(authoring.runtime.pageErrors, [])
  assert.deepEqual(authoring.runtime.failedRequests, [])
  assert.equal(numericValuesAreZero(authoringCleanup), true)
  assert.equal(gallery.status, "passed")
  assert.equal(gallery.cleanupReceipt.allZero, true)
  assert.deepEqual(gallery.runtime.consoleErrors, [])
  assert.deepEqual(gallery.runtime.pageErrors, [])
  assert.deepEqual(gallery.runtime.failedRequests, [])
  assert.deepEqual(
    gallery.viewports.map(({ height, state, width }) => [state, width, height]),
    ["five", "zero", "one", "broken"].flatMap((state) => [
      [state, 1280, 800],
      [state, 768, 1024],
      [state, 390, 844],
      [state, 320, 844],
    ]),
  )
  for (const { screenshot } of gallery.viewports)
    assertGalleryReceipt(gallery.scenarios[screenshot])
}

export async function buildManifest(context, initial, final) {
  const runs = []
  for (const runNumber of [1, 2]) {
    const artifacts = await readRunArtifacts(path.join(context.evidenceDir, `run-${runNumber}`))
    runs.push({
      authoringCleanup: artifacts.authoringCleanup,
      authoringResponseStatuses: artifacts.authoring.runtime.responses,
      cleanupAllZero:
        numericValuesAreZero(artifacts.authoringCleanup) &&
        artifacts.gallery.cleanupReceipt.allZero,
      createDraftCount: artifacts.authoring.createDraftCount,
      galleryResponseStatuses: artifacts.gallery.runtime.responses,
      imageCountAfterRetry: artifacts.authoring.imageCountAfterRetry,
      publicScenarios: artifacts.gallery.scenarios,
      publicTempRemoved: artifacts.gallery.cleanupReceipt.server.tempRemoved,
      run: runNumber,
      staleConflictStatus: 409,
      traceRedaction: {
        authoring: artifacts.authoring.traceRedaction,
        public: artifacts.gallery.traceRedaction,
      },
    })
  }
  return {
    commands: context.processRunner.commandResults.map(({ code, label, signal, timedOut }) => ({
      code,
      label,
      signal,
      timedOut,
    })),
    finalOwnership: final,
    initialOwnership: initial,
    runs,
    sourceAggregateSha256: context.sourceBinding.aggregateSha256,
    sourceCoverage: context.sourceBinding.coverage,
  }
}

async function readRunArtifacts(runDir) {
  const readJson = async (name) => JSON.parse(await readFile(path.join(runDir, name), "utf8"))
  return {
    authoring: await readJson("authoring/browser-qa.json"),
    authoringCleanup: await readJson("authoring/cleanup.json"),
    gallery: await readJson("public/public-gallery-browser-report.json"),
  }
}

function assertGalleryReceipt(receipt) {
  assert.equal(receipt.metrics.documentScrollWidth, receipt.width)
  assert.equal(receipt.metrics.textOverflow, false)
  assert.equal(receipt.metrics.focus.focusVisible, true)
  assert.equal(receipt.metrics.focus.outlineWidth, "2px")
  assert.ok(receipt.mediaBox.width > 0 && receipt.mediaBox.height > 0)
  assert.equal(receipt.titleMetrics.textWrap, "balance")
  assert.equal(receipt.titleMetrics.scrollWidth <= receipt.titleMetrics.clientWidth, true)
  assert.equal(
    receipt.titleMetrics.lastLineTokens.length === 1 &&
      receipt.titleMetrics.lastLineTokens[0].length <= 2,
    false,
  )
  assert.equal(
    receipt.metrics.images.every((image) => image.complete && image.naturalWidth > 0),
    true,
  )
}

function numericValuesAreZero(value) {
  return Object.values(value)
    .filter((item) => typeof item === "number")
    .every((item) => item === 0)
}
