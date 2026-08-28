import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  liveHttpApiTestFiles,
  managedLocalRuntimeApiTestFiles,
  noRuntimeApiContractFiles,
} from "./api-contract-inventory.mjs"

const packageJson = JSON.parse(readFileSync("package.json", "utf8"))

test("Given API contract files, when inventory is read, then root coverage is complete and disjoint", () => {
  const rootTests = readdirSync("tests")
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `tests/${name}`)
    .sort()
  const inventoriedRootTests = [
    ...noRuntimeApiContractFiles,
    ...liveHttpApiTestFiles,
    ...managedLocalRuntimeApiTestFiles,
  ]
    .filter((name) => path.dirname(name) === "tests")
    .sort()

  assert.deepEqual(inventoriedRootTests, rootTests)
  assert.equal(
    noRuntimeApiContractFiles.some((name) => liveHttpApiTestFiles.includes(name)),
    false,
  )
  assert.deepEqual(liveHttpApiTestFiles, [
    "tests/payments-api.test.mjs",
    "tests/reservations-api.test.mjs",
  ])
  assert.deepEqual(managedLocalRuntimeApiTestFiles, ["tests/money-operations-concurrency.test.mjs"])
})

test("Given package commands, when ownership is inspected, then contracts are no-runtime and live is managed", () => {
  assert.equal(packageJson.scripts?.["test:api:contracts"], "node tests/run-api-contracts.mjs")
  assert.equal(packageJson.scripts?.["test:api:live"], "node tests/auth-ui-e2e/run-api-tests.mjs")
  assert.equal(
    packageJson.scripts?.["test:money-operations:live"],
    "node --test --test-concurrency=1 tests/money-operations-concurrency.test.mjs",
  )

  const lifecycleSource = readFileSync("tests/auth-ui-e2e/lifecycle.mjs", "utf8")
  assert.match(lifecycleSource, /liveHttpApiTestFiles/u)
  assert.match(lifecycleSource, /--test-concurrency=1/u)
})
