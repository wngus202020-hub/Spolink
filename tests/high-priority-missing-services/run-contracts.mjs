#!/usr/bin/env node
import { spawn } from "node:child_process"

const files = [
  "tests/high-priority-route-coverage-contract.test.mjs",
  "tests/documentation-alignment-contract.test.mjs",
  "tests/coach-certification/documentation-and-inclusion.test.mjs",
  "tests/shared-transition-contract.test.mjs",
  "tests/lesson-authoring-contract.test.mjs",
  "tests/lesson-authoring-route.test.mjs",
  "tests/lesson-authoring-sql-contract.test.mjs",
  "tests/reservation-lifecycle-contract.test.mjs",
  "tests/favorites-mutation-contract.test.mjs",
  "tests/reviews.test.mjs",
  "tests/trust-safety.test.mjs",
  "tests/notifications.test.mjs",
  "tests/money-operations-contract.test.mjs",
  "tests/money-operations-concurrency.test.mjs",
  "tests/admin-reservation-operations.test.mjs",
]

const child = spawn("node", ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" })
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
