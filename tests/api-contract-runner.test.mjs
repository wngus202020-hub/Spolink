import assert from "node:assert/strict"
import test from "node:test"

import { noRuntimeApiContractFiles } from "./api-contract-inventory.mjs"
import { runApiContractTests } from "./api-contract-runner.mjs"

test("Given the no-runtime inventory, when the runner starts, then every file is passed to node:test", () => {
  let observed = null
  const exitCode = runApiContractTests((binary, args, options) => {
    observed = { args, binary, options }
    return { status: 0 }
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(observed, {
    args: ["--test", ...noRuntimeApiContractFiles],
    binary: process.execPath,
    options: { stdio: "inherit" },
  })
})

test("Given a nonzero node:test child, when the runner exits, then the same result is returned", () => {
  assert.equal(
    runApiContractTests(() => ({ status: 19 })),
    19,
  )
})
