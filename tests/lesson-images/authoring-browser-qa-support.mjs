import { mkdir } from "node:fs/promises"

import { runTimeoutMs } from "./authoring-browser/constants.mjs"
import { createAuthoringFixture } from "./authoring-browser/fixture.mjs"

export function readEvidenceDirectory(argument) {
  if (!argument) throw new TypeError("Evidence directory argument is required")
  return argument
}

export async function createAuthoringHarness(evidenceDir) {
  await mkdir(evidenceDir, { mode: 0o700, recursive: true })
  const fixture = await createAuthoringFixture(evidenceDir)
  return {
    fixture,
    requestSequence: [],
    runtime: null,
    session: null,
    sportId: null,
    traceStopped: false,
    viewportReceipts: [],
  }
}

export function installAuthoringInterruption(harness) {
  let runTimedOut = false
  const close = () => {
    void harness.session?.context.close().catch(() => undefined)
    void harness.session?.browser.close().catch(() => undefined)
  }
  const handler = () => close()
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"]
  for (const signal of signals) process.on(signal, handler)
  const timer = setTimeout(() => {
    runTimedOut = true
    close()
  }, runTimeoutMs)
  return {
    assertCompleted: () => {
      if (runTimedOut) throw new Error("Authoring browser QA timed out")
    },
    dispose: () => {
      clearTimeout(timer)
      for (const signal of signals) process.removeListener(signal, handler)
    },
  }
}
