#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import process from "node:process"

export const expectedDevRouteImport = 'import "./.next/dev/types/routes.d.ts";'

const productionRouteImport = 'import "./.next/types/routes.d.ts";'

export async function readNextTypeState(repoRoot = process.cwd()) {
  const [tsconfigText, nextEnvText] = await Promise.all([
    readFile(`${repoRoot}/tsconfig.json`, "utf8"),
    readFile(`${repoRoot}/next-env.d.ts`, "utf8"),
  ])
  const tsconfig = JSON.parse(tsconfigText)
  const includes = tsconfig.include
  if (!Array.isArray(includes)) throw new Error("tsconfig include must be an array")
  const devIncludeCount = includes.filter((entry) => entry === ".next/dev/types/**/*.ts").length
  return {
    devIncludeCount,
    line3: nextEnvText.split(/\r?\n/)[2] ?? "",
    nextEnvSha256: sha256(nextEnvText),
    tsconfigSha256: sha256(tsconfigText),
  }
}

export async function restoreNextDevRouteReference(repoRoot = process.cwd()) {
  const filePath = `${repoRoot}/next-env.d.ts`
  const before = await readFile(filePath, "utf8")
  const lines = before.split(/\r?\n/)
  if (lines[2] === expectedDevRouteImport) {
    return { changed: false, state: await readNextTypeState(repoRoot) }
  }
  if (lines[2] !== productionRouteImport) {
    throw new Error(`Unexpected next-env.d.ts route import: ${lines[2] ?? "<missing>"}`)
  }
  lines[2] = expectedDevRouteImport
  await writeFile(filePath, lines.join("\n"), "utf8")
  return { changed: true, state: await readNextTypeState(repoRoot) }
}

export async function assertNextTypeState(repoRoot = process.cwd(), expectedTsconfigSha256 = null) {
  const state = await readNextTypeState(repoRoot)
  if (state.devIncludeCount !== 1) {
    throw new Error('tsconfig include must contain ".next/dev/types/**/*.ts" exactly once')
  }
  if (state.line3 !== expectedDevRouteImport) {
    throw new Error("next-env.d.ts line 3 must import ./.next/dev/types/routes.d.ts")
  }
  if (expectedTsconfigSha256 !== null && state.tsconfigSha256 !== expectedTsconfigSha256) {
    throw new Error("tsconfig hash changed during Next type stabilization")
  }
  return state
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function main() {
  const command = process.argv[2]
  if (command === "assert") {
    console.log(JSON.stringify(await assertNextTypeState()))
  } else if (command === "restore") {
    console.log(JSON.stringify(await restoreNextDevRouteReference()))
  } else {
    throw new Error("usage: node tests/supabase-e2e/next-type-stability.mjs <assert|restore>")
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
