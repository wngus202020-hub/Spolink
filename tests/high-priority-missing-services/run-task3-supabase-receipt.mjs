#!/usr/bin/env node
import { runTask3SupabaseReceipt } from "./task3-supabase-receipt.mjs"

try {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "--attempt" || !args[1]) {
    throw new Error("Usage: run-task3-supabase-receipt.mjs --attempt <active-attempt-dir>")
  }
  const result = await runTask3SupabaseReceipt({ attempt: args[1] })
  process.stdout.write(`${JSON.stringify({ ...result, verdict: "passed" })}\n`)
} catch (error) {
  process.stderr.write(
    `Task 3 Supabase receipt rejected: ${error instanceof Error ? error.message : "unknown error"}\n`,
  )
  process.exitCode = 1
}
