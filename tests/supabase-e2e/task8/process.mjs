import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { buildChildEnv } from "./helpers.mjs"

export async function runCorepackPnpm(args, { envKind, outputPath, controls = {} } = {}) {
  return runCaptured({
    args: ["pnpm", ...args],
    command: "corepack",
    controls,
    envKind,
    outputPath,
  })
}

export async function runNode(args, { controls = {}, outputPath } = {}) {
  return runCaptured({
    args,
    command: process.execPath,
    controls,
    envKind: "e2e",
    outputPath,
  })
}

export async function runCaptured({ args, command, controls, envKind, outputPath }) {
  const env = buildChildEnv(envKind, process.env, controls)
  const result = await spawnBuffered(command, args, { env })
  if (outputPath) {
    await writeRedactedOutput(outputPath, { args, command, ...result }, controls.runSecrets ?? [])
  }
  return result
}

export function spawnBuffered(command, args, { env, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? (signal ? 128 : 1), signal, stderr, stdout })
    })
  })
}

export async function writeRedactedOutput(filePath, value, runSecrets = []) {
  const text = redactText(JSON.stringify(value, null, 2), runSecrets)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${text}\n`, { mode: 0o600 })
  return sha256(`${text}\n`)
}

export function redactText(value, runSecrets = []) {
  let text = value
  for (const secret of normalizeRunSecrets(runSecrets)) {
    text = replaceAllLiteral(text, secret, `<redacted-run-secret:${sha256(secret)}>`)
    text = replaceAllLiteral(
      text,
      JSON.stringify(secret).slice(1, -1),
      `<redacted-run-secret:${sha256(secret)}>`,
    )
  }
  return text
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted-jwt>")
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{12,}\b/g, "<redacted-supabase-key>")
    .replace(/\b[A-Za-z0-9._%+-]+@spolink\.test\b/gi, "<redacted-fixture-email>")
    .replace(/\blocal-(?:provider|seed)-\d+\b/g, "<redacted-provider-key>")
    .replace(/\bspolink_[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, "<redacted-provider-order>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<redacted-uuid>",
    )
    .replace(/\b(authorization)\s*[:=]\s*(?:bearer|basic)?\s*[^\r\n"']+/gi, "$1: <redacted-auth>")
    .replace(/\b(cookie|set-cookie)\s*[:=]\s*[^\r\n"']+/gi, "$1: <redacted-cookie>")
    .replace(/\bpostgres(?:ql)?:\/\/[^/\s?#@]+@/gi, "postgres://<redacted-db-uri>@")
    .replace(
      /"([^"]*(?:api[_-]?key|authorization|cookie|set-cookie|database[_-]?url|id[_-]?token|password|provider[_-]?payment[_-]?key|refresh[_-]?token|secret|service[_-]?role[_-]?key|token|toss[_-]?payments[_-]?secret[_-]?key)[^"]*)"\s*:\s*"[^"]*"/gi,
      '"$1":"<redacted>"',
    )
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeRunSecrets(runSecrets) {
  if (!Array.isArray(runSecrets)) return []
  return runSecrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .sort((left, right) => right.length - left.length)
}

function replaceAllLiteral(value, search, replacement) {
  return search.length === 0 ? value : value.split(search).join(replacement)
}
