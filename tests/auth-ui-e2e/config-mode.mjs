import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const configPath = "supabase/config.toml"

export { assertAuthConfigDelta, rewriteAuthConfig } from "./auth-config-schema.mjs"
export { createAuthSupabaseWorkspace } from "./auth-supabase-workspace.mjs"

import { assertAuthConfigDelta, rewriteAuthConfig } from "./auth-config-schema.mjs"

export async function readConfigSnapshot(filePath = configPath) {
  const bytes = await readFile(filePath)
  return { bytes, path: filePath, sha256: sha256(bytes), text: bytes.toString("utf8") }
}

export async function restoreConfigSnapshot(snapshot) {
  await writeFile(snapshot.path, snapshot.bytes, { mode: 0o600 })
  const restored = await readConfigSnapshot(snapshot.path)
  if (restored.sha256 !== snapshot.sha256) throw new Error("Config byte restoration failed")
  return restored
}

export async function applyAuthConfigMode({ baseUrl, enableConfirmations, filePath = configPath }) {
  assertLocalBaseUrl(baseUrl)
  const snapshot = await readConfigSnapshot(filePath)
  const nextText = rewriteAuthConfig(snapshot.text, { baseUrl, enableConfirmations })
  assertAuthConfigDelta(snapshot.text, nextText, { baseUrl, enableConfirmations })
  await writeFile(filePath, nextText, { mode: 0o600 })
  return { after: await readConfigSnapshot(filePath), snapshot }
}

export async function withAuthConfigMode(options, callback) {
  const { snapshot } = await applyAuthConfigMode(options)
  try {
    return await callback(snapshot)
  } finally {
    await restoreConfigSnapshot(snapshot)
  }
}

export function assertNoExternalTestBaseUrl(env = process.env) {
  if (typeof env.SPOLINK_TEST_BASE_URL === "string" && env.SPOLINK_TEST_BASE_URL.length > 0) {
    throw new Error("Auth E2E owns its Next server; SPOLINK_TEST_BASE_URL is rejected")
  }
}

function assertLocalBaseUrl(baseUrl) {
  const url = new URL(baseUrl)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error("Auth E2E baseUrl must be http://127.0.0.1:<port>")
  }
  if (Number(url.port) === 3002) throw new Error("Auth E2E must not use port 3002")
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("Auth E2E baseUrl must be an origin")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
