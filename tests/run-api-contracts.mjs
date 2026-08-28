#!/usr/bin/env node
import { runApiContractTests } from "./api-contract-runner.mjs"

try {
  process.exitCode = runApiContractTests()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
