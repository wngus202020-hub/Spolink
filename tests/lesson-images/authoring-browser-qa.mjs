import assert from "node:assert/strict"
import { createRuntimeReceipt, openAuthoringBrowser } from "./authoring-browser/browser-session.mjs"
import { runDraftRecoveryScenario } from "./authoring-browser/draft-recovery-scenario.mjs"
import { runEditingScenario } from "./authoring-browser/editing-scenario.mjs"
import { cleanupAuthoringFixture, provisionAuthoringFixture } from "./authoring-browser/fixture.mjs"
import {
  preserveFailureTrace,
  stopAndRedactTrace,
  writeAuthoringReport,
} from "./authoring-browser/report.mjs"
import { observeAuthoringServer } from "./authoring-browser/server-observer.mjs"
import { runSubmissionScenario } from "./authoring-browser/submission-scenario.mjs"
import {
  createAuthoringHarness,
  installAuthoringInterruption,
  readEvidenceDirectory,
} from "./authoring-browser-qa-support.mjs"

const harness = await createAuthoringHarness(readEvidenceDirectory(process.argv[2]))
const interruption = installAuthoringInterruption(harness)

try {
  harness.sportId = await provisionAuthoringFixture(harness.fixture)
  harness.session = await openAuthoringBrowser()
  harness.runtime = createRuntimeReceipt()
  harness.requestSequence = observeAuthoringServer(harness.session.page, harness.runtime)

  const scenarioHarness = { ...harness, page: harness.session.page }
  const draft = await runDraftRecoveryScenario(scenarioHarness)
  const editing = await runEditingScenario(scenarioHarness, draft)
  const mobileFocusState = await runSubmissionScenario(scenarioHarness)

  assert.deepEqual(harness.runtime.consoleErrors, [])
  assert.deepEqual(harness.runtime.pageErrors, [])
  assert.deepEqual(harness.runtime.failedRequests, [])
  interruption.assertCompleted()
  const traceRedaction = await stopAndRedactTrace(harness)
  await writeAuthoringReport(harness, { draft, editing, mobileFocusState }, traceRedaction)
} finally {
  interruption.dispose()
  await preserveFailureTrace(harness)
  if (harness.session?.context) await harness.session.context.close()
  if (harness.session?.browser) await harness.session.browser.close()
  await cleanupAuthoringFixture(harness.fixture)
}
