import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const testsRoot = path.dirname(fileURLToPath(import.meta.url))

export const liveHttpApiTestFiles = Object.freeze([
  "tests/payments-api.test.mjs",
  "tests/reservations-api.test.mjs",
])

export const managedLocalRuntimeApiTestFiles = Object.freeze([
  "tests/money-operations-concurrency.test.mjs",
])

const runtimeTestSet = new Set([...liveHttpApiTestFiles, ...managedLocalRuntimeApiTestFiles])

export const noRuntimeApiContractFiles = Object.freeze([
  ...readTestFiles(testsRoot)
    .map((name) => `tests/${name}`)
    .filter((name) => !runtimeTestSet.has(name)),
  ...readTestFiles(path.join(testsRoot, "profile-api")).map((name) => `tests/profile-api/${name}`),
  ...readTestFiles(path.join(testsRoot, "coach-certification")).map(
    (name) => `tests/coach-certification/${name}`,
  ),
  "tests/auth-ui-e2e/coach-applicant-runner.test.mjs",
])

function readTestFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
}
