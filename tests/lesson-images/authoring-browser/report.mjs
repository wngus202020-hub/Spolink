import assert from "node:assert/strict"

import { writePrivateJson } from "../../lesson-authoring-browser-qa-support.mjs"
import { redactPlaywrightTrace } from "../redact-playwright-trace.mjs"
import { traceName } from "./constants.mjs"

export async function stopAndRedactTrace(harness) {
  await harness.session.context.tracing.stop({ path: tracePath(harness.fixture.evidenceDir) })
  harness.traceStopped = true
  const traceRedaction = await redactPlaywrightTrace(
    tracePath(harness.fixture.evidenceDir),
    forbiddenValues(harness.fixture),
  )
  assert.equal(traceRedaction.forbiddenPatternMatches, 0)
  return traceRedaction
}

export async function preserveFailureTrace(harness) {
  if (!harness.session?.context || harness.traceStopped) return
  await harness.session.context.tracing.stop({ path: tracePath(harness.fixture.evidenceDir) })
  await redactPlaywrightTrace(
    tracePath(harness.fixture.evidenceDir),
    forbiddenValues(harness.fixture),
  )
}

export async function writeAuthoringReport(harness, results, traceRedaction) {
  const { draft, editing, mobileFocusState } = results
  await writePrivateJson(`${harness.fixture.evidenceDir}/browser-qa.json`, {
    cleanupReceipt: "cleanup.json",
    compensatedRegistrationFailure: draft.compensationState,
    createDraftCount: 1,
    focus: {
      deleteCancel: editing.deleteCancelFocusState,
      deleteConfirm: editing.deleteConfirmFocusState,
      partialFailureAlert: draft.alertFocusState,
      screenshots: [
        "task-7-focus-error-desktop.png",
        "task-7-focus-delete-cancel-desktop.png",
        "task-7-focus-mobile.png",
      ],
      viewport390: mobileFocusState,
    },
    desktopScreenshot: "task-7-edit-desktop.png",
    imageCountAfterRetry: 5,
    mobileHorizontalOverflow: false,
    mobileScreenshot: "task-7-readonly-mobile.png",
    partialFailureStates: ["registered", "failed", "queued", "queued", "queued"],
    partialFailureScreenshot: "task-7-partial-failure.png",
    preexistingNextPreserved: true,
    preexistingSupabasePreserved: true,
    readOnlyVerified: true,
    requestSequence: harness.requestSequence,
    runtime: harness.runtime,
    staleConflictGuidanceVerified: true,
    submitDuringActiveIntentStatus: draft.submitRaceStatus,
    textUpdatedAtChangedByImageActions: false,
    trace: traceName,
    traceRedaction,
    unsavedTextPreservedAcrossImageActions: true,
    viewportReceipts: harness.viewportReceipts,
  })
}

function forbiddenValues(fixture) {
  return [
    fixture.credentials.email,
    fixture.credentials.password,
    fixture.userId,
    fixture.coachProfileId,
    fixture.getLessonId() ?? "",
  ]
}

function tracePath(evidenceDir) {
  return `${evidenceDir}/${traceName}`
}
