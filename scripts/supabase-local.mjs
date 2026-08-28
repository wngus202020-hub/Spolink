#!/usr/bin/env node
import process from "node:process"

export * from "./supabase-local/authorization.mjs"
export * from "./supabase-local/constants.mjs"
export * from "./supabase-local/docker.mjs"
export * from "./supabase-local/env.mjs"
export * from "./supabase-local/lifecycle.mjs"
export * from "./supabase-local/lock.mjs"
export * from "./supabase-local/receipt.mjs"
export * from "./supabase-local/spawn.mjs"
export * from "./supabase-local/status-config.mjs"
export * from "./supabase-local/stopped-state.mjs"

import { runDoctor } from "./supabase-local/docker.mjs"
import { runReset, runStart, runStatus, runStop, runTestDb } from "./supabase-local/lifecycle.mjs"
import { assertStoppedState } from "./supabase-local/stopped-state.mjs"

async function main() {
  const command = process.argv[2]
  try {
    if (command === "start") {
      const result = await runStart()
      console.log(
        JSON.stringify({
          runId: result.runId,
          dockerOwnership: result.dockerOwnership,
          status: result.status,
        }),
      )
    } else if (command === "status") {
      console.log(JSON.stringify(await runStatus()))
    } else if (command === "reset") {
      console.log(JSON.stringify(await runReset()))
    } else if (command === "test-db") {
      await runTestDb()
      console.log(JSON.stringify({ testDb: "ok" }))
    } else if (command === "stop") {
      console.log(JSON.stringify(await runStop()))
    } else if (command === "assert-stopped") {
      console.log(JSON.stringify(await assertStoppedState({})))
    } else if (command === "doctor") {
      console.log(JSON.stringify(await runDoctor()))
    } else {
      throw new Error(
        "usage: node scripts/supabase-local.mjs <start|status|reset|test-db|stop|assert-stopped|doctor>",
      )
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main()
}
