import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"

import { readSupabaseServiceEnv } from "../lib/supabase/env.ts"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && specifier.startsWith(".")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { cleanupExpiredLessonImageUploads } = await import("../lib/storage/lesson-images.ts")

const DEFAULT_LIMIT = 25
const DEFAULT_TIMEOUT_MS = 30_000

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (!options.execute) throw new Error("Refusing cleanup without --execute.")

  const env = readSupabaseServiceEnv()
  const url = new URL(env.supabaseUrl)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Lesson image cleanup is restricted to local Supabase.")
  }

  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false },
  })
  const cleanup = cleanupExpiredLessonImageUploads(options.limit, {
    claimExpiredUploadIntents: async (limit) => {
      const { data, error } = await supabase.rpc("claim_expired_lesson_image_upload_intents", {
        checked_limit: limit,
      })
      if (error) throw new Error("Cleanup claim failed.")
      return (data ?? []).map((row) => ({
        claimToken: row.claim_token,
        id: row.id,
        objectName: row.object_name,
      }))
    },
    finalizeCleanup: async (intentId, claimToken, cleaned) => {
      const { error } = await supabase.rpc("finalize_lesson_image_upload_intent_cleanup", {
        checked_claim_token: claimToken,
        checked_cleaned: cleaned,
        checked_intent_id: intentId,
      })
      if (error) throw new Error("Cleanup finalization failed.")
    },
    removeObject: async (bucket, objectName) => {
      const { error } = await supabase.storage.from(bucket).remove([objectName])
      if (!error) return "removed"
      if (isStorageNotFound(error)) return "not_found"
      throw new Error("Storage cleanup failed.")
    },
  })

  const result = await withTimeout(cleanup, options.timeoutMs)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function parseOptions(args) {
  const execute = args.includes("--execute")
  const limit = readIntegerOption(args, "--limit", DEFAULT_LIMIT, 1, 100)
  const timeoutMs = readIntegerOption(args, "--timeout-ms", DEFAULT_TIMEOUT_MS, 1_000, 120_000)
  return { execute, limit, timeoutMs }
}

function readIntegerOption(args, name, fallback, minimum, maximum) {
  const prefix = `${name}=`
  const raw = args.find((argument) => argument.startsWith(prefix))
  if (!raw) return fallback
  const value = Number(raw.slice(prefix.length))
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${name} value.`)
  }
  return value
}

function isStorageNotFound(error) {
  return error.status === 404 || error.statusCode === 404 || error.statusCode === "404"
}

async function withTimeout(operation, timeoutMs) {
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Lesson image cleanup timed out.")), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

main().catch(() => {
  process.stderr.write(`${JSON.stringify({ error: "lesson_image_cleanup_failed" })}\n`)
  process.exitCode = 1
})
