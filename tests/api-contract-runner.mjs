import { spawnSync } from "node:child_process"

import { noRuntimeApiContractFiles } from "./api-contract-inventory.mjs"

export function runApiContractTests(run = spawnSync) {
  const result = run(process.execPath, ["--test", ...noRuntimeApiContractFiles], {
    stdio: "inherit",
  })
  if (result.error) throw result.error
  return typeof result.status === "number" ? result.status : 1
}
