import { fixturePaths, publish } from "./learner-reservations-evidence-publication-helpers.mjs"

const fixture = fixturePaths(process.env["SPOLINK_PUBLICATION_ROOT"])
const staged = {
  runId: process.env["SPOLINK_PUBLICATION_RUN_ID"],
  screenshotsDir: process.env["SPOLINK_PUBLICATION_SCREENSHOTS"],
  summaryPath: process.env["SPOLINK_PUBLICATION_SUMMARY"],
}
const phase = process.env["SPOLINK_PUBLICATION_PHASE"]
const kill = async () => process.kill(process.pid, "SIGKILL")
await publish(fixture, staged, {
  afterPointerSwap: phase === "post-swap" ? kill : undefined,
  beforePointerSwap: phase === "pre-swap" ? kill : undefined,
})
