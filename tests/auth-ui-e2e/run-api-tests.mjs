#!/usr/bin/env node
import { runApiTestLifecycle } from "./lifecycle.mjs"

try {
  const result = await runApiTestLifecycle()
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
