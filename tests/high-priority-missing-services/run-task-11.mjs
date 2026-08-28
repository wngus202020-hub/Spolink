#!/usr/bin/env node
import { spawn } from "node:child_process"

const child = spawn("node", ["tests/high-priority-missing-services/run-contracts.mjs"], {
  stdio: "inherit",
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
