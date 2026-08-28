#!/usr/bin/env node
import { assertStoppedState } from "../../../scripts/supabase-local/stopped-state.mjs"
import { runReset, runStart, runStop } from "../../../scripts/supabase-local.mjs"
import { readGuardedLocalStatus } from "../local-status.mjs"
import { createFocusedRunner } from "./runtime/focused-runner.mjs"
import { runExactLessonImageTest } from "./runtime/test-child.mjs"

const runner = createFocusedRunner({
  assertStopped: () => assertStoppedState({}),
  readStatus: readGuardedLocalStatus,
  reportWorking(message) {
    console.log(`WORKING: ${message}`)
  },
  reset: runReset,
  runSuite: runExactLessonImageTest,
  start: runStart,
  stop: runStop,
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => runner.receiveSignal(signal))
}

const result = await runner.run({
  holdMs: readHoldMs(process.env.SPOLINK_TASK9_HOLD_BEFORE_SUITE_MS),
  label: readLabel(process.argv),
})

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.cleanupError) console.error("Owned guarded runtime cleanup failed")
process.exitCode = result.exitCode

function readHoldMs(value) {
  if (value === undefined) return 0
  if (!/^[0-9]+$/u.test(value)) throw new Error("Focused hold must be decimal milliseconds")
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 60_000) {
    throw new Error("Focused hold must be between 0 and 60000 milliseconds")
  }
  return parsed
}

function readLabel(argv) {
  const index = argv.indexOf("--label")
  const value = index >= 0 ? argv[index + 1] : "focused"
  if (!value || !/^[a-z0-9-]+$/u.test(value)) {
    throw new Error("Focused run label must contain lowercase letters, digits, or hyphens")
  }
  return value
}
