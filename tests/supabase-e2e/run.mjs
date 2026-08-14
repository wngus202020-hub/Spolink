#!/usr/bin/env node
import { runTodo8 } from "./task8/orchestrator.mjs"

try {
  await runTodo8()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
