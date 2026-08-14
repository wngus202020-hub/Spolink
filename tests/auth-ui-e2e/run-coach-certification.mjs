#!/usr/bin/env node
import { runCoachCertification } from "./run-coach-applicant.mjs"

try {
  await runCoachCertification()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
